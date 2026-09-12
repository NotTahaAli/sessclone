# 24: Schema — tiers, subscriptions, log artifacts

**What to build:** The billing and archival tables, shaped so a payment provider can be attached later without a migration.

**Blocked by:** 01, 11, 13.

**Status:** ready-for-agent

- [ ] Tier carries seat price, included seats, retention ceiling, and a capability field
- [ ] Subscription carries a provider and nullable provider identifiers
- [ ] Every activation writes a subscription event
- [ ] Log artifact records its Session, storage key, hash, size, and upload time
- [ ] Policies ship in the same migration
