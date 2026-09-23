-- Taha, 2026-09-23: "when an org is enterprise, show the decided price in
-- settings". Enterprise is "Contact" on every card, and the price agreed with
-- one Org was stored nowhere.
--
-- Base plus per seat, monthly, in US cents, on the Org's own subscription
-- row, both nullable: null is "no agreed price", and the Tier's published one
-- (or "Contact") still applies. Integers in cents, never a float for money.
--
-- Additive only: two nullable columns, no default, nothing existing code
-- reads. No policy changes: `subscriptions_write` already limits every write
-- to a Platform Admin, which is who records an agreed price, and
-- `subscriptions_read` already lets an Org's members read their own row.
alter table subscriptions
  add column if not exists price_base_cents integer
    check (price_base_cents >= 0),
  add column if not exists price_seat_cents integer
    check (price_seat_cents >= 0);
