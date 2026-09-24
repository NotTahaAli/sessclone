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

-- An agreed price is billing, and billing changes belong in the history: the
-- trigger returned early whenever Tier and status held, so re-pricing an Org
-- left no event and the operator's note went nowhere. The event now carries
-- the price that was true then, like `tier_id` and `status`, and a price-only
-- change writes one. Nullable columns with no default: deployed code that
-- reads the history names its columns and never sees them.
alter table subscription_events
  add column if not exists price_base_cents integer,
  add column if not exists price_seat_cents integer;

-- Byte-identical to the original apart from the price, keeping the path that
-- `20260920120600_search_path.sql` set: `create or replace` replaces SET
-- clauses with whatever this statement says, so it must say it again. Grants
-- survive a replace; the revoke is repeated so this file does not rely on it.
create or replace function sessclone_write_subscription_event() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.tier_id is not distinct from old.tier_id
     and new.price_base_cents is not distinct from old.price_base_cents
     and new.price_seat_cents is not distinct from old.price_seat_cents then
    return new;
  end if;

  insert into subscription_events
    (subscription_id, org_id, status, tier_id, actor_user_id, provider, note,
     price_base_cents, price_seat_cents)
  values (
    new.id, new.org_id, new.status, new.tier_id, sessclone_user_id(), new.provider,
    nullif(current_setting('sessclone.subscription_note', true), ''),
    new.price_base_cents, new.price_seat_cents
  );

  return new;
end
$$;

revoke execute on function sessclone_write_subscription_event() from public;
