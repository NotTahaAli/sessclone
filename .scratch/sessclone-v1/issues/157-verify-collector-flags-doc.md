# 157: Document every `verify-collector.mjs` flag in the install guide

**Good first issue.** Docs only.

**What to build:** `docs/install.md` shows `--reconcile --day <date> --tz
<zone>` and nothing else. It never mentions `--no-probe` (for a machine that
cannot reach the deployment), that leaving out `--day` counts every day, or
that `--tz` defaults to the machine's zone. The script's own `--help` already
has the wording.

**Blocked by:** 155, so the guide describes the final behaviour

**Status:** todo

- [ ] A short table of `--reconcile`, `--day`, `--tz` and `--no-probe` with
      their defaults, worded from the script's `--help`
- [ ] One line saying `--help` prints the same list
- [ ] `pnpm format` passes
