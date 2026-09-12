# 48: Manual activation

**What to build:** A Platform Admin turns an Org's subscription on by hand once payment has arrived some other way, and the record survives the arrival of a real payment rail.

**Blocked by:** 47.

**Status:** ready-for-agent

- [ ] Activation and deactivation both possible, with a note recorded
- [ ] Each writes a subscription event carrying who did it and when
- [ ] Entitlement checks read subscription status and Tier, nothing provider-specific
- [ ] An inactive Org is told it is inactive rather than shown a broken dashboard
