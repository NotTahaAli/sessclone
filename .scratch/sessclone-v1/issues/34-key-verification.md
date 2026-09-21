# 34: Key verification on ingest

**What to build:** Ingest accepts only live keys, attributes each report to the right Member, and records when each key was last used. Extends the route test suite.

**Blocked by:** 28, 31.

**Status:** done

- [x] Key verified by hash; the Member and Org resolved from it
- [x] An unknown or revoked key is rejected and writes nothing
- [x] Last-used time written on each accepted report, surfacing in the key list
- [x] Route tests extended with the rejection cases
