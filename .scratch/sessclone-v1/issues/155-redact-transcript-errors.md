# 155: `redact-transcript.mjs` gets `--help` and a readable error on a bad line

**Good first issue.** A contributor-facing script; the logic moves into a
tested function.

**What to build:** `scripts/redact-transcript.mjs` is what
`packages/shared/fixtures/transcripts/README.md` tells fixture contributors to
run. `--help` alone prints the usage line but exits 1, `--help x` reads a file
named `--help`, and one truncated JSONL line throws a bare `SyntaxError` with
no line number.

**Blocked by:** none

**Status:** todo

- [ ] `--help` and `-h` print the usage line and exit 0
- [ ] The pure part becomes an exported `redactJsonl(source)` in
      `packages/shared/src/redact.ts`, which throws with the line number of a
      line that is not JSON and keeps the refusal of already-redacted input
- [ ] The script prints `<input>:<n>: not valid JSON` and exits 1
- [ ] Tests in `redact.test.ts`: a bad second line names line 2, blank lines
      are skipped, output ends with exactly one newline, input containing
      `[redacted` is refused
- [ ] `pnpm test` passes
