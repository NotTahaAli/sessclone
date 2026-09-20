# 61: Retention

**What to build:** Transcripts stop accumulating forever: an Org sets how long they are kept, within what its Tier allows, and older ones are removed.

**Blocked by:** 47, 51, 59.

**Status:** ready-for-agent

- [ ] Retention set by an Owner or Admin, defaulted, and capped by the Tier ceiling
- [ ] Artifacts past the window removed from storage and from the record
- [ ] Turns are never touched by retention, so spend history survives
- [ ] Removal is idempotent and safe to re-run
