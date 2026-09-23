-- The seat ceiling binds only a plan somebody approved.
--
-- `sessclone_org_seat_ceiling` read `max_seats` off whatever row the Org had,
-- whatever its status. Before ticket 118 a new Org had no row and so no
-- ceiling; since then a sign-up asks for its plan as an `inactive` row, and
-- with `SIGNUP_APPROVAL=off` (nobody to approve it) a Personal ask capped the
-- Org at one Seat for good. An ask is not an entitlement, so the one row that
-- sets no ceiling is an unapproved ask: `inactive` with a `requested_seats`
-- the sign-up stated. Everything else still caps — a `cancelled` plan, and an
-- `inactive` row the operator wrote (no `requested_seats`) — so lapsing or
-- being parked never lets an Org grow past the Tier it holds.
--
-- `create or replace` keeps the grants but not the `set` clause, so the
-- original's `security definer` and `search_path` are restated here.
create or replace function sessclone_org_seat_ceiling(org uuid)
  returns integer language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select tier.max_seats
    from subscriptions subscription
    join tiers tier on tier.id = subscription.tier_id
   where subscription.org_id = org
     and not (subscription.status = 'inactive'
              and subscription.requested_seats is not null)
$$;
