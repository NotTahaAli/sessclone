# 75: Projects transcript fixture

**What to build:** A redacted Claude Projects transcript in the corpus, so the
parser is tested against what a Projects environment actually writes rather than
against the assumption that it writes what a laptop writes.

**Blocked by:** 08, 74.

**Status:** done

- [x] Captured from a live Projects session and redacted by the existing allowlist, not by hand
- [x] Carries the multi-block split — several usage-bearing entries sharing one `message.id` — at the ratio the live session produced
- [x] Carries the Projects-only entry fields, so a parser change that chokes on them fails here
- [x] README row says what the fixture is evidence for, in the corpus's own terms
- [x] `corpus.test.ts` asserts the ratio rather than the file's presence

**Built:** `packages/shared/fixtures/transcripts/projects-thread-session.jsonl`,
cut from a live Projects thread session on Claude Code 2.1.278 and redacted by
`scripts/redact-transcript.mjs`. Nine usage-bearing entries across three
`message.id` values, split by `apiBlockIndex` 0/1/2 — the 3:1 overcount ADR
0006 exists for, measured rather than argued. Two assertions in
`corpus.test.ts` carry it: one on the ratio, one on the Projects-only entry
fields, which survive redaction as placeholders because the allowlist replaces
values and keeps keys.

The capture is where the work was. `redact-transcript.mjs` refuses any file
containing the string `[redacted`, and the session being captured had read
`redact.ts` and quoted a placeholder back, so it refused its own transcript.
The raw file is sliced before the first such line and then redacted; the README
says so, and says why loosening the guard is the wrong fix.
