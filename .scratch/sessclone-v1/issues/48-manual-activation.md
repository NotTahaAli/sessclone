# 48: Manual activation

**What to build:** A Platform Admin turns an Org's subscription on by hand once payment has arrived some other way, and the record survives the arrival of a real payment rail.

**Blocked by:** 47.

**Status:** done

- [x] Activation and deactivation both possible, with a note recorded
- [x] Each writes a subscription event carrying who did it and when
- [x] Entitlement checks read subscription status and Tier, nothing provider-specific
- [x] An inactive Org is told it is inactive rather than shown a broken dashboard

**Superseded in part by 119 (2026-09-23):** collection no longer keeps working for `inactive`, missing or `cancelled` subscriptions — those Orgs are locked behind a waiting page unless `SIGNUP_APPROVAL=off`. `past_due` keeps this ticket's banner and keeps working.
