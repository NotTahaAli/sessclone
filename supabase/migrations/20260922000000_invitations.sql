-- Ticket 49: invitations, and the seat limit enforced where it can be.
--
-- An invitation is a capability: whoever holds the token may join the Org it
-- names, as the Role it names, once, until it expires. The token itself is
-- never stored — `token_hash` is the sha256 the dashboard computes, exactly as
-- `api_keys.key_hash` is — so a reader of this table, including an Admin of
-- the Org, cannot replay an invitation they did not receive.
--
-- The seat limit is checked when the invitation is accepted rather than when
-- it is sent (the ticket says so, and it is the only honest moment): Members
-- come and go between the two, and a check at send time would refuse an
-- invitation that will fit and admit one that will not.

create table invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  -- The address the invitation was sent to. Matched case-insensitively at
  -- acceptance against the signed-in person's own verified address, so an
  -- invitation is not a bearer token for a different account.
  email text not null check (length(btrim(email)) > 0),
  -- Never 'owner': an Org has its Owner from the bootstrap in `members_invite`
  -- and handing that Role out by email is a transfer of the Org, which is
  -- ticket 50's business and not an invitation's.
  role member_role not null default 'member' check (role <> 'owner'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references members (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_member_id uuid references members (id) on delete set null,
  revoked_at timestamptz,
  check (accepted_at is null or revoked_at is null)
);

-- One live invitation per address per Org. A second "invite" of the same
-- person is the same intent, and two live tokens for one seat is a way to
-- exceed a limit that is checked one acceptance at a time.
create unique index invitations_live_email_key
  on invitations (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

create index invitations_org_created_idx
  on invitations (org_id, created_at desc);

alter table invitations enable row level security;

-- Only the people who may invite may see the list. The invitee never reads
-- this table: they present a token, and `sessclone_accept_invitation` answers.
create policy invitations_read on invitations for select
  using (org_id in (select sessclone_admin_org_ids()));

create policy invitations_create on invitations for insert
  with check (org_id in (select sessclone_admin_org_ids()));

-- Revoking is the only write from the dashboard; the guard below says so.
create policy invitations_revoke on invitations for update
  using (org_id in (select sessclone_admin_org_ids()))
  with check (org_id in (select sessclone_admin_org_ids()));

-- What an invitation is cannot change after it is sent. Otherwise an Admin
-- could point a token somebody already holds at a different Org, a different
-- address or a higher Role — which is the whole capability, rewritten under
-- the holder.
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
  return new;
end $$;

create trigger invitations_guard_columns before update on invitations
  for each row execute function sessclone_guard_invitation_columns();

/**
 * Seats in use: one per Member who has not been removed.
 *
 * `CONTEXT.md` — a Seat is one billable Member, and a person rather than a
 * machine, so a Member with six Devices is one Seat and a removed Member is
 * none. `security definer` because the caller accepting an invitation is not
 * yet a Member of the Org and so may read none of its `members` rows.
 */
create or replace function sessclone_org_seats(org uuid) returns integer
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select count(*)::integer from members
   where org_id = org and removed_at is null
$$;

/**
 * Accepts an invitation, or says why it cannot be accepted.
 *
 * `security definer` because every step is refused to the caller by design:
 * they cannot read `invitations`, cannot read the Org's `members`, and cannot
 * insert themselves into an Org they do not administer. The token is what
 * authorises all of it, and it is presented as its hash so this function never
 * receives the secret either.
 *
 * Raises rather than returning a code, so a caller that forgets to check gets
 * a failed transaction rather than a silent non-join. Each message is one a
 * person can act on; none of them says whether some *other* invitation exists,
 * so this is not an oracle for which addresses have been invited.
 */
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
    select tier.max_seats into ceiling
      from subscriptions subscription
      join tiers tier on tier.id = subscription.tier_id
     where subscription.org_id = invite.org_id;

    seats := sessclone_org_seats(invite.org_id);
    if ceiling is not null and seats >= ceiling then
      raise exception 'this Org has no seat free (% of % in use)', seats, ceiling;
    end if;

    insert into members (org_id, user_id, role)
    values (invite.org_id, caller, invite.role)
    on conflict (org_id, user_id) do update set removed_at = null
    returning id into member_id;
  end if;

  update invitations
     set accepted_at = now(), accepted_member_id = member_id
   where id = invite.id;

  return invite.org_id;
end $$;

-- The dashboard connects as `sessclone_app`, which owns nothing and is granted
-- what it needs and no more.
-- **Re-admission by invitation.**
--
-- `sessclone_guard_member_columns` gives `removed_at` to an Owner or an Admin,
-- which is right for removal and one case short for the other end: somebody
-- who left and has been invited back accepts their own invitation, and is by
-- definition not an Admin of the Org they are rejoining. Without this branch
-- the `on conflict` above raises and a re-invited person can never join.
--
-- It is not a flag the caller can set. The condition is a live, unaccepted,
-- unexpired invitation for this Org addressed to this user's own email — the
-- same capability the acceptance itself runs on — and the policy on `members`
-- already refuses a removed Member any update of their own row, so the only
-- writers that reach this branch are an Admin or `sessclone_accept_invitation`.
create or replace function sessclone_guard_member_columns() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
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

  if new.archival_enabled is distinct from old.archival_enabled
     and old.user_id is distinct from sessclone_user_id() then
    raise exception 'archival is the member''s own switch';
  end if;

  if new.role is distinct from old.role
     and old.org_id not in (select sessclone_admin_org_ids()) then
    raise exception 'only an owner or admin may change a role';
  end if;

  if new.removed_at is distinct from old.removed_at
     and old.org_id not in (select sessclone_admin_org_ids())
     and not (
       new.removed_at is null
       and exists (
         select 1 from invitations invite
           join users account on lower(account.email) = lower(invite.email)
          where invite.org_id = old.org_id
            and account.id = old.user_id
            and invite.accepted_at is null
            and invite.revoked_at is null
            and invite.expires_at > now()
       )
     ) then
    raise exception 'only an owner or admin may remove or re-admit a member';
  end if;

  return new;
end $$;

grant select, insert, update on invitations to sessclone_app;
grant execute on function sessclone_accept_invitation(text) to sessclone_app;
grant execute on function sessclone_org_seats(uuid) to sessclone_app;
