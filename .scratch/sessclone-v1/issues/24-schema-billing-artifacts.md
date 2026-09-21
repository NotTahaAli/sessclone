# 24: Schema — tiers, subscriptions, log artifacts

**What to build:** The billing and archival tables, shaped so a payment provider can be attached later without a migration.

**Blocked by:** 01, 11, 13.

**Status:** done

- [x] Tier carries seat price, included seats, retention ceiling, and a capability field
- [x] Subscription carries a provider and nullable provider identifiers
- [x] Every activation writes a subscription event
- [x] Log artifact records its Session, storage key, hash, size, and upload time
- [x] Policies ship in the same migration

**Answer:** `supabase/migrations/20260920120400_billing_artifacts.sql` creates `tiers`,
`subscriptions`, `subscription_events` and `log_artifacts`, with their policies
in the same file.

A Tier carries `base_price_usd` beside `seat_price_usd` so a flat plan, a
per-seat plan and a contact-us plan are one shape; `included_seats`,
`min_seats` and `max_seats`; `retention_max_days` as the ceiling on ticket 61's
setting; `archival_available` as the one capability v1 gates outright; and
`features jsonb` for the next one.

The Tier lives on the subscription rather than on `orgs`, so an entitlement
check reads status and Tier from one row and cannot read a torn pair. Every
activation writes a `subscription_events` row through an `after` trigger, and
that trigger is `security definer` while the table carries neither an insert
policy nor an insert grant — so the audit trail has exactly one author and a
route cannot forget to write it. A note travels on `sessclone.subscription_note`,
set transaction-locally beside the write.

A Log Artifact is readable by `sessclone_visible_member_ids()` — the Member,
an Owner or Admin, a Manager within their Scope — and deletable only by the
Member whose transcript it is, Owner included (ADR 0005). Written by the
presign route with the service role, as `turns` is. Proven in
`apps/web/test/billing-artifacts.test.ts`.
