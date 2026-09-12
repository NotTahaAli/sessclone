# 14: ADR — Archival opt-in granularity

**What to build:** A decision resolving a contradiction in the spec: the glossary and the ingest rule make archival a Member-level choice, while the user story promises a per-Device one ("archive work sessions and not personal ones"). One of the two must change.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] States whether the opt-in is per Member or per Device, and why
- [ ] Whichever loses, the glossary or the user story is updated in the same change
- [ ] States where the flag is enforced, given that the presign route must refuse on it
