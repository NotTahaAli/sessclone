# 58: Presign route and its refusals

**What to build:** The endpoint that authorises a transcript upload — and, just as importantly, the five cases where it refuses. Extends the route test suite.

**Blocked by:** 12, 14, 22, 24, 44, 47.

**Status:** ready-for-agent

- [ ] Issues a short-lived upload URL for the Member's own Session only
- [ ] Refuses when the submitted hash matches what is already stored
- [ ] Resolves the Session to its Project server-side, ignoring the Project the request claims
- [ ] Refuses when the Member's archival master switch is off
- [ ] Refuses when the Member has excluded that Session's Project, with a reason distinguishable from the master switch being off
- [ ] Refuses when the Tier excludes archival, with a reason distinguishable from both
- [ ] Refuses when the Session has no ingested Turns to resolve a Project from
- [ ] All five refusals covered by route tests
