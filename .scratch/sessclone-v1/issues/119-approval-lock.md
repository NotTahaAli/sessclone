# 119: New Orgs are locked until approved

**What to build:** Taha, 2026-09-23. Picks: lock everything except a waiting page; `inactive` (or no row) and `cancelled` lock, `past_due` keeps the banner; existing never-activated Orgs lock too; on by default, self-host included, `SIGNUP_APPROVAL=off` turns it off.

**Where the ask forks, and what was picked (Taha's picks).**

- A locked Org sees only "Waiting for approval" (or "Cancelled") with Sign out. No keys, no pages.
- Ingest refuses a locked Org's keys with the same 401 as any bad key (no oracle).
- Replaces ticket 48's "collection keeps working" for these two states.

**Blocked by:** 118.

**Status:** todo

- [ ] Lock in the dashboard layout and the key routes
- [ ] Ingest refuses locked Orgs
- [ ] Env switch documented in self-hosting
- [ ] Tests at the cheapest level
