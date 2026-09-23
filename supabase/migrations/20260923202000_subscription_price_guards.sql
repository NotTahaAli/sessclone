-- Review of `20260923201000_subscription_price.sql`, whose comment was wrong:
-- it said "no policy changes: `subscriptions_write` already limits every write
-- to a Platform Admin". It limits updates and deletes. Inserts also pass
-- `subscriptions_request` (`20260923190000_signup_plan.sql`), which predates
-- the price columns and so said nothing about them — an Owner asking for a
-- plan could write their own agreed price onto the row, and the Owner reads
-- that price as what they pay. That migration is left as it ran; the
-- correction is here.
--
-- The policy is recreated identically, plus the two price columns held null.
-- Additive for deployed code: sign-up never sends a price.
drop policy subscriptions_request on subscriptions;

create policy subscriptions_request on subscriptions for insert
  with check (
    status = 'inactive'
    and provider = 'manual'
    and provider_customer_id is null
    and provider_subscription_id is null
    and provider_metadata is null
    and current_period_end is null
    and price_base_cents is null
    and price_seat_cents is null
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
