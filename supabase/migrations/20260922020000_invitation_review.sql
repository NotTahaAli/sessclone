-- Review fixes for ticket 49's invitations, all of them about the same thing:
-- an invitation is a capability for one address, and everything that could
-- make it a bearer token for a different account.
--
-- 1. `users.email` was self-writable, so the address check the whole design
--    rests on could be satisfied by editing your own row.
-- 2. Re-admission restored the Role the person had before they were removed,
--    discarding the Role the invitation granted.
-- 3. The seat ceiling was read outside any lock, so N concurrent acceptances
--    could overshoot it by N-1.
-- 4. `accepted_at` and `revoked_at` were editable by an Admin, which makes a
--    spent invitation live again.

-- 1. The address comes from the identity provider, never from the row.
--
-- `users_write_self` lets a person write their own row, which is right for
-- everything on it except this: `sessclone_accept_invitation` matches the
-- invited address against `users.email`, so a writable email is a way to
-- accept somebody else's invitation. Nothing in the app writes this column —
-- `ensureOrgForSigner` inserts it once, on conflict do nothing.
create or replace function sessclone_guard_user_email() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.email is distinct from old.email then
    raise exception 'an account''s address comes from the identity provider';
  end if;
  return new;
end $$;

create trigger users_guard_email
  before update on users
  for each row execute function sessclone_guard_user_email();

-- 4. Accepted and revoked are a state machine, not data.
--
-- The column guard pinned everything that identifies an invitation and left
-- the two columns that say whether it is spent. An Admin clearing either one
-- makes a used or withdrawn token work again.
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

  return new;
end $$;

-- 2 and 3. The acceptance itself.
create or replace function sessclone_accept_invitation(presented_hash text)
  returns uuid language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  invite invitations;
  caller uuid := sessclone_user_id();
  caller_email text;
  seats integer;
  ceiling integer;
  member_id uuid;
begin
  if caller is null then
    raise exception 'sign in before accepting an invitation';
  end if;

  select email into caller_email from users where id = caller;
  if caller_email is null then
    raise exception 'sign in before accepting an invitation';
  end if;

  -- `for update` so two tabs accepting the same invitation at once cannot
  -- both pass the used-and-expired checks below.
  select * into invite from invitations
   where token_hash = presented_hash for update;

  -- One message for absent, revoked and already-used alike: the three are
  -- indistinguishable to somebody holding a link, and telling them apart tells
  -- a stranger which tokens once existed.
  if invite.id is null or invite.revoked_at is not null
     or invite.accepted_at is not null then
    raise exception 'this invitation is not valid';
  end if;

  if invite.expires_at <= now() then
    raise exception 'this invitation has expired; ask for another';
  end if;

  if lower(caller_email) <> lower(invite.email) then
    raise exception 'this invitation was sent to a different address';
  end if;

  -- Already in the Org: not an error worth failing on, but not a second Seat
  -- either. The invitation is spent and the Role left alone — a Role change is
  -- ticket 50's, and an invitation must not become a way to demote somebody.
  select id into member_id from members
   where org_id = invite.org_id and user_id = caller and removed_at is null;

  if member_id is null then
    -- The row lock above serialises two acceptances of the *same* invitation
    -- and nothing else. Two different invitations to one Org lock two
    -- different rows, both count the seats from a snapshot taken before either
    -- insert commits, and both pass a ceiling that only one of them should.
    -- This lock is per Org, so the count and the insert below are one step.
    perform pg_advisory_xact_lock(hashtextextended(invite.org_id::text, 0));

    -- No subscription row means no ceiling, deliberately: activation is a
    -- Platform Admin's manual act (ticket 48, ADR 0004), so every Org is
    -- un-activated until an operator gets to it and a ceiling of zero would
    -- mean nobody could ever be invited into a new Org. A Tier's seat limit
    -- binds from the moment the Org has a Tier.
    select tier.max_seats into ceiling
      from subscriptions subscription
      join tiers tier on tier.id = subscription.tier_id
     where subscription.org_id = invite.org_id;

    seats := (select count(*)::integer from members
               where org_id = invite.org_id and removed_at is null);
    if ceiling is not null and seats >= ceiling then
      raise exception 'this Org has no seat free (% of % in use)', seats, ceiling;
    end if;

    -- Re-admission takes the Role the invitation granted, not the one the
    -- person had before they were removed: the conflicting row is a tombstone,
    -- so there is no incumbent Role to protect, and an Admin invited back as a
    -- Member must come back as a Member. `archival_enabled` resets for the
    -- same reason — it is a consent given by a membership that ended.
    insert into members (org_id, user_id, role)
    values (invite.org_id, caller, invite.role)
    on conflict (org_id, user_id) do update
       set removed_at = null,
           role = excluded.role,
           archival_enabled = false
    returning id into member_id;
  end if;

  update invitations
     set accepted_at = now(), accepted_member_id = member_id
   where id = invite.id;

  return invite.org_id;
end $$;

-- The re-admission branch of the column guard, widened to the two columns the
-- acceptance now writes and narrowed to the person the row is about.
--
-- The invitation named here is the caller's own: `old.user_id` has to be the
-- caller, which is what makes this a capability the accepter holds rather than
-- a flag any writer can set. The policy on `members` already refuses a removed
-- Member every update of their own row, so this branch is defence in depth
-- rather than the only lock.
create or replace function sessclone_guard_member_columns() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare
  readmitting boolean;
begin
  if tg_op = 'INSERT' then
    if new.archival_enabled and new.user_id is distinct from sessclone_user_id() then
      raise exception 'archival is the member''s own switch';
    end if;
    return new;
  end if;

  if new.org_id is distinct from old.org_id
     or new.user_id is distinct from old.user_id then
    raise exception 'a member row cannot change org or user';
  end if;

  readmitting := old.removed_at is not null
    and new.removed_at is null
    and old.user_id = sessclone_user_id()
    and exists (
      select 1 from invitations invite
        join users account on lower(account.email) = lower(invite.email)
       where invite.org_id = old.org_id
         and account.id = old.user_id
         and invite.role = new.role
         and invite.accepted_at is null
         and invite.revoked_at is null
         and invite.expires_at > now()
    );

  if new.archival_enabled is distinct from old.archival_enabled
     and old.user_id is distinct from sessclone_user_id()
     and not readmitting then
    raise exception 'archival is the member''s own switch';
  end if;

  if new.role is distinct from old.role
     and old.org_id not in (select sessclone_admin_org_ids())
     and not readmitting then
    raise exception 'only an owner or admin may change a role';
  end if;

  if new.removed_at is distinct from old.removed_at
     and old.org_id not in (select sessclone_admin_org_ids())
     and not readmitting then
    raise exception 'only an owner or admin may remove or re-admit a member';
  end if;

  return new;
end $$;
