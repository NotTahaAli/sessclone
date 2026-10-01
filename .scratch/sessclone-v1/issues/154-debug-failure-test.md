# 154: A unit test for the Collector's debug output

**Good first issue.** One small test file beside the code it tests.

**What to build:** `packages/plugin/src/debug.mjs` exports `debugFailure`,
which prints a swallowed hook error to stderr only when `SESSCLONE_DEBUG` is
set to a non-empty value (the docs say `1`).
Its comment promises it prints the error message and never the configuration
(which holds the API key). Nothing tests either half of that.

**Blocked by:** none

**Status:** todo

- [ ] `packages/plugin/src/debug.test.mjs`, in the style of `deadline.test.mjs`,
      spying on `process.stderr.write` and passing the environment in
- [ ] With `SESSCLONE_DEBUG` unset, nothing is written
- [ ] With `SESSCLONE_DEBUG=1` and an `Error`, exactly one line naming the
      hook and the error is written
- [ ] A thrown non-`Error` value still writes one line
- [ ] `pnpm test` passes
