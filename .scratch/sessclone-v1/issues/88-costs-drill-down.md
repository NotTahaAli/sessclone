# 88: A Costs row opens its Turns, and a Turn opens its breakdown

**What to build:** Two levels of drill-down under the Costs views, decided with Taha on 2026-09-22.

Today a ranked row — a model, a project, a device, a person — is a dead end: it names a total and nothing beneath it. Clicking one lists the Turns in that cut, over the same period and the same date-range control, and clicking a Turn shows what it actually consumed.

**The Turn list.** Newest first, paginated, each row naming the Session, the project, the model, the time and the cost. Filtered by whichever cut was clicked, and by the period already selected. The Role scoping is the policies, as everywhere else.

**The Turn breakdown.** Every quantity `turns` records, named: input, output, cache read, cache write split 5m and 1h, thinking, web search and web fetch requests, the model, the service tier, speed and inference geography, the client version, the spawn depth, and whether the Turn is complete. Cost per quantity beside each, from `turn_costs`. A quantity with no Rate is shown as unpriced and never as zero, which is the rule ticket 42 fixed once already; a cache-write total with no 5m/1h split is unpriced too.

This Turn row and this breakdown are the components ticket 86's session detail uses. One implementation, two callers.

**Blocked by:** 42, 53, 81.

**Status:** open

- [ ] A ranked row opens the Turns of that cut, in the selected period
- [ ] The Turn list is paginated, newest first, and Role-scoped by the policies
- [ ] A Turn's breakdown names every recorded quantity with its own cost
- [ ] An unpriced quantity reads as unpriced, never as zero
- [ ] The Turn row and breakdown are shared with ticket 86 rather than duplicated
- [ ] The reads are index-backed; no query in a loop
- [ ] Screenshots at 1440x900 and 390x844, light and dark
