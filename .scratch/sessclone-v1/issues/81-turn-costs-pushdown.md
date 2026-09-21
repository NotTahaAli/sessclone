# 81: Make turn_costs filterable, so a chart prices one Org and not the deployment

**What to build:** `turn_costs` (ticket 42) groups by Turn, so a caller's `org_id` and date range cannot push through it. A join from a filtered `turns` therefore prices every Turn in the deployment first. Measured on one box at 200k Turns (100k in the target Org), a 30-day Org chart takes 21.9s, against 39ms for the same arithmetic written inline; the cost is the `distinct on` sort over seven rows per Turn plus the non-equi rate join, not the scan.

Adding `org_id` and `occurred_at` to the view restores pushdown but only reaches 17.1s, so the shape has to change: keep one row per Turn throughout, resolving the winning Rate per `(org_id, model, on_date)` into the seven classes as seven columns, and computing the Turn's Cost as a single scalar expression. That removes the sort as well as the fanout.

**Blocked by:** 42.

**Blocks:** 52.

**Status:** ready-for-agent

- [ ] `turn_costs` filterable by Org and date without pricing the deployment
- [ ] Every result identical to today's view — the costs suite passes unchanged
- [ ] `security_invoker` kept, and read as an unprivileged role in a test
- [ ] The 30-day Org chart query measured at 200k Turns, before and after, in the commit message
