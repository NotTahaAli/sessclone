-- The Org switcher: a person's own invitations, answered from the dashboard,
-- and leaving an Org.
--
-- Until now an invitation was reachable only by its link: the invitee cannot
-- read `invitations` (`invitations_read` is Owner or Admin of the Org), and
-- that stays true. Everything the invitee does here goes through the
-- `security definer` functions below, each of which is keyed on the caller's
-- *verified* address — the one Supabase's session carries, passed in by the
-- dashboard exactly as it passes the user id — and never on `users.email`,
-- which is written once at first sign-in and does not follow an address
-- change at the identity provider (Taha, 2026-09-25).
--
-- No new table, so no new policy. The functions are revoked from PUBLIC and
-- granted to `sessclone_app` alone, as `20260923180000_definer_execute.sql`
-- does for the rest.

-- 1. Declined, beside accepted and revoked.
--
-- A declined invitation is hidden from the invitee and shown to the Org as
-- declined; it is not deleted, because the Admin's list is where "they said
-- no" is read. Dismissing an expired invitation is the same write, and the
-- Admin's list tells the two apart by whether it happened before the expiry.
alter table invitations add column declined_at timestamptz;

alter table invitations
  add constraint invitations_one_outcome
  check (num_nonnulls(accepted_at, revoked_at, declined_at) <= 1);

-- An Admin may invite somebody again after they declined, so a declined
-- invitation no longer holds the address's one live slot.
drop index invitations_live_email_key;
create unique index invitations_live_email_key
  on invitations (org_id, lower(email))
  where accepted_at is null and revoked_at is null and declined_at is null;

-- What `sessclone_own_invitations` looks up: open invitations by address,
-- across every Org.
create index invitations_open_email_idx
  on invitations (lower(email))
  where accepted_at is null and revoked_at is null and declined_at is null;

-- 2. `declined_at` is the invitee's, through the functions below, and never a
-- column the dashboard role writes. An Admin may update an invitation to
-- revoke it (`invitations_revoke`), so the guard, not the policy, is what
-- stops them marking one declined. Inside a definer function `current_user`
-- is the owner of the table; anywhere else it is not.
create or replace function sessclone_guard_invitation_columns() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.org_id is distinct from old.org_id
     or new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.token_hash is distinct from old.token_hash
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'an invitation is fixed once sent; revoke it and send another';
  end if;

  if old.accepted_at is not null and new.accepted_at is distinct from old.accepted_at then
    raise exception 'an accepted invitation stays accepted';
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a withdrawn invitation stays withdrawn';
  end if;

  if new.declined_at is distinct from old.declined_at
     and (old.declined_at is not null
          or current_user is distinct from (
            select pg_get_userbyid(relowner) from pg_class where oid = tg_relid)) then
    raise exception 'only the person invited may decline an invitation';
  end if;

  return new;
end $$;

-- 3. The column guard on `members`, with its two self-service branches.
--
-- Rewritten from the newest previous copy, `20260922120000_appearance.sql`
-- (its own header says why that matters): only the re-admission test and the
-- new leaving branch differ.
--
-- Re-admission used to find the caller's invitation by joining `users.email`,
-- which is the address this migration stops trusting. The acceptance now
-- names the invitation it is honouring in a transaction-local setting, and the
-- guard checks that invitation is live, for this Org, at this Role. Setting
-- it by hand buys nothing: `members_write` already refuses a removed Member
-- every update of their own row, so only a definer function reaches here.
--
-- Leaving: a Member may remove themselves and change nothing else. The same
-- policy refuses that write from the dashboard role (its `with check` keeps
-- a self-update's `removed_at` null), so it too is reachable only through
-- `sessclone_leave_org`. The last-Owner constraint trigger still has the
-- final word.
create or replace function sessclone_guard_member_columns() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  readmitting boolean;
  leaving boolean;
  locked boolean;
begin
  if tg_op = 'INSERT' then
    if new.archival_enabled and new.user_id is distinct from sessclone_user_id() then
      raise exception 'archival is the member''s own switch';
    end if;
    -- An invitation is an insert, so an inviter must not be able to create the
    -- row with somebody else's colours already chosen for them.
    if (new.accent_seed is not null or new.theme <> 'system')
       and new.user_id is distinct from sessclone_user_id() then
      raise exception 'appearance is the member''s own';
    end if;
    return new;
  end if;

  if new.org_id is distinct from old.org_id
     or new.user_id is distinct from old.user_id then
    raise exception 'a member row cannot change org or user';
  end if;

  readmitting := old.removed_at is not null
    and new.removed_at is null
    and old.user_id is not distinct from sessclone_user_id()
    and exists (
      select 1 from invitations invite
       where invite.id = nullif(current_setting('sessclone.admitting', true), '')::uuid
         and invite.org_id = old.org_id
         and invite.role = new.role
         and invite.accepted_at is null
         and invite.revoked_at is null
         and invite.declined_at is null
         and invite.expires_at > now()
    );

  leaving := old.removed_at is null
    and new.removed_at is not null
    and old.user_id is not distinct from sessclone_user_id()
    and new.role = old.role
    and new.archival_enabled = old.archival_enabled;

  if new.archival_enabled is distinct from old.archival_enabled
     and old.user_id is distinct from sessclone_user_id() then
    raise exception 'archival is the member''s own switch';
  end if;

  -- Ticket 77. Appearance is the Member's own, exactly as archival is, and for
  -- the same reason: `members_write` lets an Owner or an Admin update their
  -- Org's rows, so without this they could set somebody else's colours and
  -- whether that person reads at night.
  if (new.accent_seed is distinct from old.accent_seed
      or new.accent_tones is distinct from old.accent_tones
      or new.theme is distinct from old.theme)
     and old.user_id is distinct from sessclone_user_id() then
    raise exception 'appearance is the member''s own';
  end if;

  -- The mode is never locked. An Org locking its colour is a branding
  -- decision; whether somebody reads light or dark is not the Org's to take.
  if new.accent_seed is distinct from old.accent_seed then
    select org.accent_locked into locked from orgs org where org.id = new.org_id;
    if locked then
      raise exception 'this org has locked its accent colour';
    end if;
  end if;

  if new.role is distinct from old.role
     and old.org_id not in (select sessclone_admin_org_ids())
     and not readmitting then
    raise exception 'only an owner or admin may change a role';
  end if;

  if new.removed_at is distinct from old.removed_at
     and old.org_id not in (select sessclone_admin_org_ids())
     and not readmitting
     and not leaving then
    raise exception 'only an owner or admin may remove or re-admit a member';
  end if;

  return new;
end $$;

-- 3b. The last Owner, under a lock.
--
-- `members_guard_last_owner` runs at commit and counted the Owners in its own
-- snapshot, so two Owners leaving (or demoting each other) at once each saw
-- the other still there and both committed, leaving an Org with none. The
-- Org's advisory lock — the key `members_guard_seat_ceiling` already uses —
-- makes the second wait for the first to commit; its count, a new statement
-- under read committed, then sees the first one gone and refuses.
--
-- Lock order: this runs at commit, after the statement has locked its member
-- rows, so it takes row then Org, as the seat trigger does. Only when an
-- Owner stops being one, so no other write pays for it.
create or replace function sessclone_guard_last_owner() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if old.role = 'owner' and old.removed_at is null
     and (new.role <> 'owner' or new.removed_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended(old.org_id::text, 0));
    if sessclone_org_owners(old.org_id) = 0 then
      raise exception 'an org keeps at least one owner'
        using hint = 'make somebody else an owner first';
    end if;
  end if;
  return null;
end $$;

-- 4. Accepting, once, for both ways in.
--
-- The body of the old `sessclone_accept_invitation(text)` as
-- `20260922040000_admin_review.sql` left it, keyed on the invitation's id
-- rather than its token, and matched against the address the caller passes
-- from their verified session. It returns the member id, which is what the
-- dashboard remembers as the chosen Org.
--
-- No seat check and no advisory lock here: `members_guard_seat_ceiling` is
-- the one copy of that rule, and takes the Org's lock after the tuple's.
-- admin_review removed the copy that used to sit here because the two took
-- the locks in opposite orders and could deadlock.
create or replace function sessclone_accept_own_invitation(
  invitation_id uuid, verified_email text
) returns uuid language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  invite invitations;
  caller uuid := sessclone_user_id();
  joined uuid;
begin
  if caller is null or coalesce(btrim(verified_email), '') = '' then
    raise exception 'sign in before accepting an invitation';
  end if;

  -- `for update` so two tabs accepting the same invitation at once cannot
  -- both pass the used-and-expired checks below.
  select * into invite from invitations where id = invitation_id for update;

  -- One message for absent, revoked, declined and already-used alike: telling
  -- them apart tells a stranger which invitations once existed.
  if invite.id is null or invite.revoked_at is not null
     or invite.accepted_at is not null or invite.declined_at is not null then
    raise exception 'this invitation is not valid';
  end if;

  if invite.expires_at <= now() then
    raise exception 'this invitation has expired; ask for another';
  end if;

  if lower(btrim(verified_email)) <> lower(btrim(invite.email)) then
    raise exception 'this invitation was sent to a different address';
  end if;

  -- Already in the Org: the invitation is spent and the Role left alone.
  select id into joined from members
   where org_id = invite.org_id and user_id = caller and removed_at is null;

  if joined is null then
    -- The re-admission branch of the guard above reads this.
    perform set_config('sessclone.admitting', invite.id::text, true);

    insert into members (org_id, user_id, role)
    values (invite.org_id, caller, invite.role)
    on conflict (org_id, user_id) do update
       set removed_at = null,
           role = excluded.role,
           archival_enabled = false
    returning id into joined;

    perform set_config('sessclone.admitting', '', true);
  end if;

  update invitations
     set accepted_at = now(), accepted_member_id = joined
   where id = invite.id;

  return joined;
end $$;

-- The link's way in, now with the verified address. Still returns the Org, as
-- the join page expects.
create or replace function sessclone_accept_invitation(
  presented_hash text, verified_email text
) returns uuid language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  found invitations;
begin
  if sessclone_user_id() is null then
    raise exception 'sign in before accepting an invitation';
  end if;

  select * into found from invitations where token_hash = presented_hash;
  if found.id is null then
    raise exception 'this invitation is not valid';
  end if;

  perform sessclone_accept_own_invitation(found.id, verified_email);
  return found.org_id;
end $$;

-- The one-argument form the app deployed today still calls. This SQL runs on
-- production before the new app is deployed, so dropping it here would break
-- every invitation link in between. It keeps its old meaning — the address on
-- `users` — and goes through the same acceptance, so re-admission still passes
-- the members guard above. A later migration drops it once the app that
-- passes the verified address is live.
create or replace function sessclone_accept_invitation(presented_hash text)
  returns uuid language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  caller_email text;
begin
  select email into caller_email from users where id = sessclone_user_id();
  return sessclone_accept_invitation(presented_hash, caller_email);
end $$;

-- 5. Declining, and dismissing an expired one: the same write.
create or replace function sessclone_decline_own_invitation(
  invitation_id uuid, verified_email text
) returns void language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  invite invitations;
begin
  select * into invite from invitations where id = invitation_id for update;

  if sessclone_user_id() is null
     or invite.id is null
     or invite.accepted_at is not null
     or invite.revoked_at is not null
     or invite.declined_at is not null
     or lower(btrim(coalesce(verified_email, ''))) <> lower(btrim(invite.email)) then
    raise exception 'this invitation is not valid';
  end if;

  update invitations set declined_at = now() where id = invite.id;
end $$;

-- 6. The invitations addressed to the caller, for the switcher.
--
-- Open ones, and expired ones for seven days after their expiry so the person
-- can see what lapsed and dismiss it. Not the Org's Members and not the token
-- hash. It does name who sent it: the inviter's display name, or their
-- address when they have not set one — the same address the invitation email
-- already showed the invitee. Invitations into an Org they are already in
-- are left out: accepting one would change nothing.
create or replace function sessclone_own_invitations(verified_email text)
  returns table (
    id uuid,
    org_name text,
    role member_role,
    invited_by text,
    expires_at timestamptz
  )
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select invite.id,
         org.name,
         invite.role,
         coalesce(inviter.display_name, inviter.email),
         invite.expires_at
    from invitations invite
    join orgs org on org.id = invite.org_id
    left join members sender on sender.id = invite.invited_by
    left join users inviter on inviter.id = sender.user_id
   where sessclone_user_id() is not null
     and lower(invite.email) = lower(btrim(verified_email))
     and invite.accepted_at is null
     and invite.revoked_at is null
     and invite.declined_at is null
     and invite.expires_at > now() - interval '7 days'
     and not exists (
       select 1 from members member
        where member.org_id = invite.org_id
          and member.user_id = sessclone_user_id()
          and member.removed_at is null
     )
   order by invite.expires_at desc
   limit 50
$$;

-- 7. Leaving an Org.
--
-- The caller's own live membership, and nothing else. The last Owner is
-- refused with the same sentence the constraint trigger raises, before the
-- write rather than at commit.
create or replace function sessclone_leave_org(leaving uuid)
  returns void language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  mine members;
begin
  select * into mine from members
   where id = leaving
     and user_id = sessclone_user_id()
     and removed_at is null
   for update;

  if mine.id is null then
    raise exception 'not a member of that org';
  end if;

  if mine.role = 'owner' and sessclone_org_owners(mine.org_id) <= 1 then
    raise exception 'an org keeps at least one owner'
      using hint = 'make somebody else an owner first';
  end if;

  update members set removed_at = now() where id = mine.id;
end $$;

revoke execute on function sessclone_accept_own_invitation(uuid, text) from public;
revoke execute on function sessclone_accept_invitation(text, text) from public;
revoke execute on function sessclone_accept_invitation(text) from public;
revoke execute on function sessclone_decline_own_invitation(uuid, text) from public;
revoke execute on function sessclone_own_invitations(text) from public;
revoke execute on function sessclone_leave_org(uuid) from public;

grant execute on function sessclone_accept_own_invitation(uuid, text) to sessclone_app;
grant execute on function sessclone_accept_invitation(text, text) to sessclone_app;
grant execute on function sessclone_accept_invitation(text) to sessclone_app;
grant execute on function sessclone_decline_own_invitation(uuid, text) to sessclone_app;
grant execute on function sessclone_own_invitations(text) to sessclone_app;
grant execute on function sessclone_leave_org(uuid) to sessclone_app;

-- Supabase's own roles, where they exist, as the earlier migration does.
do $$
declare
  routine text;
begin
  foreach routine in array array[
    'sessclone_accept_own_invitation(uuid, text)',
    'sessclone_accept_invitation(text, text)',
    'sessclone_accept_invitation(text)',
    'sessclone_decline_own_invitation(uuid, text)',
    'sessclone_own_invitations(text)',
    'sessclone_leave_org(uuid)'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', routine);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', routine);
    end if;
  end loop;
end
$$;
