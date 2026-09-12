# 08: Transcript fixture corpus

**What to build:** The committed body of real transcripts every parser and cost test runs against, so no test invents its own idea of what Claude Code writes.

**Blocked by:** 03, 04, 07.

**Status:** done

- [x] Includes multi-block entries sharing one message id with identical Usage
- [x] Includes every bookkeeping entry type observed, including those with no id and no timestamp
- [x] Includes an Agent Run transcript carrying its parent Session id, and a workflow Agent Run transcript, both captured from a live run
- [x] Includes the resume, fork, compaction, and model-switch transcripts the spikes produced
- [x] Every fixture redacted of message content, with the redaction documented and repeatable

**Built:** `packages/shared/fixtures/transcripts/`, ten fixtures and a README
mapping each to what it proves. Redaction is an allowlist in
`packages/shared/src/redact.ts`; `scripts/redact-transcript.mjs` applies it.
`packages/shared/src/corpus.test.ts` turns the criteria above into assertions,
including a guard that fails on any string longer than 64 characters that is not
a redaction placeholder.
