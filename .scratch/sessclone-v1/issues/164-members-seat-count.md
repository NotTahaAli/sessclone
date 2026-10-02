# 164: Members page shows the Seats in use

**What to build:** Taha, 2026-10-02, from the Team walkthrough review: the
Members page heads its People with the Seats in use out of the Org's ceiling,
so an Owner or Admin sees how full the Org is before inviting.

**What was decided.**

- The ceiling is `sessclone_org_seat_ceiling()`, the function the
  `members_guard_seat_ceiling` trigger refuses against, so the page and the
  database cannot disagree. A Seat is a person: removed Members do not count.
- With a ceiling: "People · 3 of 10 Seats". With none (Enterprise without a
  limit, Self-Hosted, an unapproved ask): "People · 3 Members", as before.
- When every Seat is in use, the People note says nobody new can join until
  somebody is removed or the Org moves to a bigger plan.
- No schema change: the function was already granted to `sessclone_app`.

**Blocked by:** none

**Status:** done

- [x] Head count reads Seats out of the ceiling where there is one
- [x] An Admin reads the same ceiling the trigger uses (database test)
- [x] Full Org says so on the page (checked by screenshot)
