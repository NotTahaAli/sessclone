# 18: Dashboard wireframes and chart specs

**What to build:** The agreed shape of every dashboard view before any of it is built, including which chart answers which question.

**Blocked by:** 17.

**Status:** done

- [x] A chart type chosen per question, with the reason recorded
- [x] Layout for the org view and each breakdown
- [x] Date-range control placement and behaviour
- [x] Loading, empty, error, and unpriced-turn states drawn, not left to implementation
- [x] Token counts shown beside Cost in every view that shows Cost

**Answer:**

`docs/design/dashboard-wireframes.md`, reviewed at 390 px and 1440 px in both
themes before it was written.

A chart type is chosen per question and the reason is recorded beside it: stacked
bars per day for spend over time, sorted horizontal bars for every breakdown, a
sparkline for a single member or device, and a bare number with its previous
period for cache efficiency. Pie charts are refused for a stated reason rather
than by taste. Five series plus a neutral, with a sixth category rolled into
Other, which always takes the neutral and always sorts last.

Layout is one column on a phone with a four-item bottom bar, and on desktop a
232 px sidebar beside a 12-column content grid, chart spanning eight and the
ranked list four. The same content in the same order at both widths.

The date range is one control that holds across the view tabs and lives in the
URL, so a link to a view is a link to a period. Four states are drawn rather than
left to implementation: loading at final height with no layout shift, empty for a
quiet range, the separate onboarding surface for an org that has never received a
turn, and an error that keeps the reader's place. An unpriced turn is a hatched
neutral cap detached from the money axis, counted in the summary and never added
to the total. Token counts sit beside Cost in every view that shows Cost, because
a reader who cannot see tokens cannot tell a price change from a usage change.
