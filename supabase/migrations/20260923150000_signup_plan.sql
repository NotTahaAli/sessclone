-- Ticket 118: sign-up picks a plan, and the operator confirms it.
--
-- The plan a new Org asked for is an `inactive` subscription row on that Tier,
-- so the Admin panel shows what to confirm (ticket 120) and activation is the
-- same one-row write it always was (ticket 48). Additive only: a column, a
-- feature flag and a policy, all of which the code already deployed ignores.

-- How many Seats a Team signup asked for. A request, not an entitlement: the
-- Tier's own `min_seats`/`max_seats` still bind, and the operator reads this
-- when activating. A sign-up always states it (Personal's is 1); null only on
-- a row an operator wrote.
alter table subscriptions
  add column requested_seats integer
    check (requested_seats is null or requested_seats >= 1);

-- Which Tiers a sign-up may ask for is data (ADR 0004): `features.self_serve`.
-- Personal and Team; Enterprise is "contact us" and Self-Hosted is not sold.
-- An operator can switch it for any Tier from the admin page.
update tiers
   set features = features || '{"self_serve": true}'::jsonb
 where key in ('personal', 'team');

-- The Owner may ask for a plan, and that is all: one insert, `inactive`,
-- `manual`, with none of the provider or period columns set, on a Tier that is
-- on sale and self-serve, with a size (always stated; Personal's is 1) the
-- Tier allows. `subscriptions_write` still refuses
-- them every update, so nothing here lets an Owner activate, re-plan or
-- un-cancel their own Org — and `org_id` is unique, so an Org that already has
-- a row (any status) cannot ask again.
--
-- Owner rather than `sessclone_admin_org_ids()`: billing is the one thing an
-- Admin does not reach (`CONTEXT.md`). The membership is read under
-- `members_read`, which shows a person their own live membership.
create policy subscriptions_request on subscriptions for insert
  with check (
    status = 'inactive'
    and provider = 'manual'
    and provider_customer_id is null
    and provider_subscription_id is null
    and provider_metadata is null
    and current_period_end is null
    and exists (
      select 1 from members member
       where member.org_id = subscriptions.org_id
         and member.user_id = (select sessclone_user_id())
         and member.role = 'owner'
         and member.removed_at is null
    )
    and exists (
      select 1 from tiers tier
       where tier.id = subscriptions.tier_id
         and tier.available
         and tier.features @> '{"self_serve": true}'::jsonb
         and requested_seats is not null
         and (tier.min_seats is null or requested_seats >= tier.min_seats)
         and (tier.max_seats is null or requested_seats <= tier.max_seats)
    )
  );
