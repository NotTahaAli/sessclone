# 122: Costs drills down by day and by model, in Sessions

**What to build:** Taha, 2026-09-23, reviewing the live Costs page: "Chart seems broken, make Day clickable to show sessions on that day. Make model also clickable and show per model token breakdown." Then: every cut shows Sessions rather than Turns, and every cut's column opens with a token breakdown.

**Where the ask forks, and what was picked.**

- The chart is one slot per day for the whole period, a faint baseline, a 2px stub for an empty day, ticks on the first day, the last and today. Each bar links to its day.
- A day row or bar opens that day's Sessions (the Org's calendar day) in the Finder column; a model row opens that model's tokens by class. Cache write is one line, the reported creation total, never the 5m and 1h splits beside it.
- Other, the roll-up past the fifth model, opens nothing: it is several models.

**Blocked by:** 112.

**Status:** done

- [x] Chart redrawn, bars link to their day
- [x] Day column: that day's Sessions, paged
- [x] Model column: tokens and cost by class, then the total
- [x] Model rows carry the chevron
