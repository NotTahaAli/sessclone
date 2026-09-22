-- The seat ceiling, in one place, and two sharp edges in the member guard.
--
-- Ticket 49 put the ceiling inside `sessclone_accept_invitation`, which is one
-- of the two ways a Member becomes live: the other is an Admin clearing
-- `removed_at` from the Members page (ticket 50), which counted nothing. So an
-- Org on a Tier that sells five Seats could hold six by re-admitting somebody,
-- and a re-admission racing an acceptance passed the count the acceptance's
-- lock protects.
--
-- A trigger rather than a check in each writer, because "each writer
-- remembers" is exactly how the first hole happened. Both paths now route
-- through one rule, and a third writer added later gets it for free.

/**
 * The ceiling an Org's Tier sets, or null for no ceiling.
 *
 * No subscription row means no ceiling, deliberately and as
 * `sessclone_accept_invitation` already has it: activation is a Platform
 * Admin's manual act (ticket 48, ADR 0004), so a brand-new Org has no Tier and
 * a ceiling of zero would mean nobody could ever be added to one.
 *
 * `security definer` because the caller may be re-admitting themselves by
 * invitation and so may read neither the subscription nor the Tier.
 */
create or replace function sessclone_org_seat_ceiling(org uuid)
  returns integer language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select tier.max_seats
    from subscriptions subscription
    join tiers tier on tier.id = subscription.tier_id
   where subscription.org_id = org
$$;

/**
 * Refuses a Member who would take a Seat the Tier does not sell.
 *
 * Fires on the two writes that make a Member live — an insert, and an update
 * that clears `removed_at` — and on nothing else: a Role change, a rename or a
 * removal cannot take the Org over a ceiling it is already under.
 *
 * The advisory lock is per Org and is taken before the count, so two
 * concurrent writers serialise: without it both read a count taken before
 * either row is visible and both pass a ceiling only one of them should.
 * `sessclone_accept_invitation` takes the same lock on the same key, so the
 * two paths serialise against each other as well as against themselves.
 */
create or replace function sessclone_guard_seat_ceiling() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  ceiling integer;
  seats integer;
begin
  if tg_op = 'UPDATE' and not (old.removed_at is not null and new.removed_at is null) then
    return new;
  end if;
  if tg_op = 'INSERT' and new.removed_at is not null then
    return new;
  end if;

  ceiling := sessclone_org_seat_ceiling(new.org_id);
  if ceiling is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text, 0));

  select count(*) into seats from members
   where org_id = new.org_id and removed_at is null and id <> new.id;

  if seats >= ceiling then
    raise exception 'this Org has no seat free (% of % in use)', seats, ceiling;
  end if;

  return new;
end $$;

create trigger members_guard_seat_ceiling
  before insert or update on members
  for each row execute function sessclone_guard_seat_ceiling();

-- The column guard, with two corrections.
--
-- `readmitting` was three-valued: `old.user_id = sessclone_user_id()` is null
-- when there is no claim, so `not readmitting` was null, and plpgsql reads a
-- null condition as false — which turned every branch below into a no-op
-- exactly when the caller had no identity at all. `is not distinct from` is
-- the two-valued form of the same test.
--
-- The archival branch no longer consults it: `readmitting` can only be true
-- when the row belongs to the caller, and that branch already returns early in
-- that case, so the clause was dead.
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
    and old.user_id is not distinct from sessclone_user_id()
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
     and old.user_id is distinct from sessclone_user_id() then
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

-- An operator can correct an address the identity provider changed.
--
-- The guard added with the invitation fixes froze `users.email` for everybody,
-- including the Platform Admin, and nothing in the app re-syncs it:
-- `ensureOrgForSigner` inserts on conflict do nothing. So somebody whose
-- address changes keeps the old one forever, and invitations to their real
-- address are refused as "sent to a different address" with no way out. The
-- operator is the way out; an account still cannot rename itself.
create or replace function sessclone_guard_user_email() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.email is distinct from old.email
     and not sessclone_is_platform_admin() then
    raise exception 'an account''s address comes from the identity provider';
  end if;
  return new;
end $$;
