# 03: Spike — resume and fork transcripts

**What to build:** An answer, not code: when a Session is resumed or forked, does it append to the same transcript or open a new one, does the Session id change, and do entry ids repeat.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Resume and fork both exercised on a real session
- [x] Findings note states whether Turn identity survives both, with evidence
- [x] Any transcript captured is handed to ticket 08

**Answer:** `docs/findings/03-resume-fork.md`. Resume appends to the same file
and keeps the id. A fork opens a new file, rewrites `sessionId` on every copied
row, and repeats every `uuid` and `message.id` verbatim — so `message_id` is the
only field that survives a fork, and the only way to detect one.
