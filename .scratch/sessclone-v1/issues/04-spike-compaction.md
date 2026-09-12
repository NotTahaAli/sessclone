# 04: Spike — compaction artifacts

**What to build:** An answer: what a compaction leaves in the transcript, whether `SessionStart` fires with the compact source, and whether previously written bytes survive it.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Compaction triggered deliberately on a real session
- [x] Findings note states whether the transcript remains append-only across it
- [x] States whether any summary entry carries Usage that would otherwise be counted
- [x] Any transcript captured is handed to ticket 08

**Answer:** `docs/findings/04-compaction.md`. Append-only holds at the byte
level, so the Collector's cursor survives a compaction untouched. No summary
entry carries Usage — compaction cannot inflate cost, it hides it, because the
summarisation call itself is never written with usage. Manual compaction was
exercised; the automatic path is inferred, not measured.
