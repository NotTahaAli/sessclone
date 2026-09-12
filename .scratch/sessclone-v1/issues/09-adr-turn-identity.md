# 09: ADR — Turn identity and dedup

**What to build:** A recorded decision on what makes a Turn unique, so the schema and the parser cannot disagree about it later.

**Blocked by:** 03, 04, 07.

**Status:** ready-for-agent

- [ ] States the identity key and why the per-entry id is not it
- [ ] Cites the measured overcount that rules the alternative out
- [ ] States how resume, fork, and compaction interact with the key, per the spikes
- [ ] States that ingest writes are idempotent by conflict, not by prior lookup
