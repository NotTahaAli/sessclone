# 58: Presign route and its refusals

**What to build:** The endpoint that authorises a transcript upload — and, just as importantly, the three cases where it refuses. Extends the route test suite.

**Blocked by:** 12, 14, 22, 24, 44, 47.

**Status:** ready-for-agent

- [ ] Issues a short-lived upload URL for the Member's own Session only
- [ ] Refuses when the submitted hash matches what is already stored
- [ ] Refuses when archival is not opted in, at the granularity the ADR settled
- [ ] Refuses when the Tier excludes archival, with a reason distinguishable from not-opted-in
- [ ] All three refusals covered by route tests
