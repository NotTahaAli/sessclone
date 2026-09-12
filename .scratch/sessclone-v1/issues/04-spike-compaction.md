# 04: Spike — compaction artifacts

**What to build:** An answer: what a compaction leaves in the transcript, whether `SessionStart` fires with the compact source, and whether previously written bytes survive it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Compaction triggered deliberately on a real session
- [ ] Findings note states whether the transcript remains append-only across it
- [ ] States whether any summary entry carries Usage that would otherwise be counted
- [ ] Any transcript captured is handed to ticket 08
