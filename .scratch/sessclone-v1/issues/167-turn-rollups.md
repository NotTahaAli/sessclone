# 167: Dashboard reads from Turn rollups

**What to build:** Taha, 2026-10-03: the dashboard had become "super slow and
borderline unusable"; optimise it for millions and billions of Turns.

Every Costs and Sessions read priced each Turn in its period and then summed,
so a page cost as much as its period had Turns. Production: one Org's 30-day
Costs read was 0.41s over 21k Turns before row-level security. Locally at 2M
Turns: Sessions 7.0s, Costs 6.6s.

**What was decided.**

- `turn_rollups`: one row per Session, Agent Run, Project, Device, model,
  Org-local day, multiplier and counter shape, holding the Turns' sums. Kept
  by statement triggers on `turns` (insert adds; update and delete recompute
  the Sessions touched) and rebuilt for an Org when its timezone changes.
- Prices stay out of it: `turn_rollup_costs` prices each row at read time with
  `turn_costs`' precedence, so a Rate change still reprices history with no
  backfill. Exact, because a group shares its Rates, multiplier and shape.
- `turn_rollups_read` is `turns_read` on the day's first instant; the history
  floor is itself a day's first instant, so a row is wholly in or out.
- Costs (time, people, Projects, Devices, token columns), Sessions list and
  Session summary, Devices' 30-day count, the Rates page's unknown models and
  `projects_read`'s visible Projects read rollups. The Turn list, a Turn's
  page, Agent Runs and the transcript costs still read Turns: each is one
  Session or one Turn.
- The Sessions list picks its page from unpriced rollups and prices only that
  page.

**Blocked by:** none

**Status:** done

- [x] Rollups equal Turns after insert, duplicate, update, delete, timezone
      change and a Rate added later (`rollups.test.ts`)
- [x] Full DB suite green
- [x] Measured: 2M Turns, Sessions 7.0s to 0.05s, Costs 6.6s to 0.25s
