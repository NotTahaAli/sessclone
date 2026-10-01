# 153: `verify-collector.mjs` ignores `--day` or `--tz` given with no value

**Good first issue.** A real bug in a small script, with a pure function to
pull out and test.

**What to build:** In `scripts/verify-collector.mjs`, `value()` returns
`undefined` when a flag is the last argument, so
`node scripts/verify-collector.mjs --reconcile --day` counts every day and
exits 0. Someone checking one day gets the all-time total and no warning. The
same happens when the next argument is another flag (`--day --tz UTC`).

**Blocked by:** none

**Status:** todo

- [ ] Argument parsing moves into an exported pure function (for example
      `parseArgs(argv)`) so it can be tested without running the script
- [ ] A value flag with no value, or followed by another `--flag`, prints
      `--day needs a value` (or `--tz`) to stderr and exits 2, the code the
      date-format check already uses
- [ ] Tests: `--reconcile --day` and `--reconcile --day --tz UTC` are errors
      naming the flag; `--reconcile --day 2026-09-22` parses to that day; a
      badly formatted date is still refused
- [ ] `pnpm test` passes
