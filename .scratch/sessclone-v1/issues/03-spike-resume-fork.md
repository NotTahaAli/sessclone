# 03: Spike — resume and fork transcripts

**What to build:** An answer, not code: when a Session is resumed or forked, does it append to the same transcript or open a new one, does the Session id change, and do entry ids repeat.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Resume and fork both exercised on a real session
- [x] Findings note states whether Turn identity survives both, with evidence
- [x] Any transcript captured is handed to ticket 08

**Answer:** `docs/findings/03-resume-fork.md`. Resume appends to the same file
and keeps the id. A fork opens a new file, rewrites `sessionId` on every copied
row, and repeats every `uuid` and `message.id` verbatim. `sessionId` is the only
field a fork changes, so every other identifier joins a fork back to its
original — and the entry `uuid` is the better join than `message_id`, which is
not row-unique even within one session.
