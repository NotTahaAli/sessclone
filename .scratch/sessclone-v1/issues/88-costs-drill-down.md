# 88: A Costs row opens its Turns, and a Turn opens its breakdown

**What to build:** Two levels of drill-down under the Costs views, decided with Taha on 2026-09-22.

Today a ranked row — a model, a project, a device, a person — is a dead end: it names a total and nothing beneath it. Clicking one lists the Turns in that cut, over the same period and the same date-range control, and clicking a Turn shows what it actually consumed.

**The Turn list.** Newest first, paginated, each row naming the Session, the project, the model, the time and the cost. Filtered by whichever cut was clicked, and by the period already selected. The Role scoping is the policies, as everywhere else.

**The Turn breakdown.** Every quantity `turns` records, named: input, output, cache read, cache write split 5m and 1h, thinking, web search and web fetch requests, the model, the service tier, speed and inference geography, the client version, the spawn depth, and whether the Turn is complete. Cost per quantity beside each, from `turn_costs`. A quantity with no Rate is shown as unpriced and never as zero, which is the rule ticket 42 fixed once already; a cache-write total with no 5m/1h split is unpriced too.

This Turn row and this breakdown are the components ticket 86's session detail uses. One implementation, two callers.

**Blocked by:** 42, 53, 81.

**Status:** done

- [x] A ranked row opens the Turns of that cut, in the selected period. The one row that does not open is People's catch-all, whose Turns belong to Members the viewer may not read — there is no group to ask for, and a link to an empty page would read as a bug.
- [x] The Turn list is paginated by an `(occurred_at, id)` cursor, newest first, and Role-scoped by the policies
- [x] A Turn's breakdown names every recorded quantity with its own cost. The seven Rates come from `sessclone_resolve_rate`, the definition of record, rather than from a second copy of the precedence rule.
- [x] An unpriced quantity reads as unpriced, never as zero — and a class the Turn consumed nothing of reads as zero, which is true. A test pins the lines against `turn_costs`'s own total, so the breakdown cannot drift from the figure the rest of the product sums.
- [x] The Turn row and breakdown are shared with ticket 86: `app/(dashboard)/turns/` holds both, and the Session detail and the cut list are its two callers
- [x] The reads are index-backed, pinned by a plan assertion. `is null` rather than `is not distinct from` for the absent group, because only the first is indexable.
- [x] Screenshots at 1440x900 and 390x844, light and dark, in `/mnt/project-files/shots-tickets-85-88/`
