# 123: Mark failed Sessions viewed

**What to build:** Taha, 2026-09-23: "allow to mark failed as Viewed". The Costs view pill's "N failed" nags until somebody has looked.

**Where the ask forks, and what was picked.**

- Per viewer, not Org-wide: each person clears their own count.
- A viewed Session stays on the failures list; it only stops counting. A failure after the mark counts again.
- The pill counts failed Sessions, not failure events: one Session in a rate-limit storm is one.
- One Session at a time, or "Mark all viewed" for the period on screen.

**Blocked by:** 78.

**Status:** done

- [x] `failure_views` with its policies, additive migration
- [x] Count is one statement, index-backed
- [x] Mark one, mark all; policy test as `sessclone_app`, action test
