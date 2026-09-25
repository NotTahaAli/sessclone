# 137: A read-only live demo

**What to build:** Taha, 2026-09-25: a visitor can try the dashboard without an account, on made-up data that stays current.

**What was picked (Taha's decisions, 2026-09-25, final).**

1. **Generated fake data**, never real usage.
2. **Two demo Orgs**, each with a fake team of six over the last 60 days, a few Sessions each, subagent Turns, Projects and Devices, and viewable transcripts (fake, no real code or secrets). Each Org gets its own randomised data, seeded from a hash of (Org, date): it looks random and is reproducible.
3. **The visitor is Owner of one demo Org** (the default on entry) **and a Member of the other**, so the Org switcher shows both and every page, Settings included, is visible read-only. Switching between them works.
4. **Every save refuses with "This is a demo"**, so no reset of visitor edits is needed. The database enforces it: each of the visitor's transactions is read-only.
5. **"Try the demo"** beside sign-up on the landing hero and on /pricing.
6. **A daily cron job at end of day** seeds the new day and deletes demo data older than 60 days, for both Orgs.
7. **Off by default** (`DEMO=on` opts in; renamed `ENABLE_DEMO=true` by ticket 138); demo Orgs never count as customers and ingest refuses them.

**Blocked by:** None

**Status:** done

- [x] `orgs.is_demo` (migration `20260925160000_live_demo.sql`), settable by the owning role alone; left out of the Admin panel's list, pending count and Tier counts; refused by ingest.
- [x] `/demo` sets an HttpOnly cookie that `sessionUser` honours only with no Supabase session and `ENABLE_DEMO=true` (was `DEMO=on`); `asViewer` opens the visitor's transactions read-only; every action returns or shows "This is a demo".
- [x] A banner on every dashboard page ("You're viewing a demo with made-up data.", Sign up, Exit demo); dashboard pages `noindex`.
- [x] Deterministic generator (`lib/demo-data.ts`) with unit tests; `/api/demo/refresh` (CRON_SECRET, idempotent, backfills, prunes rows and objects) scheduled daily in `apps/web/vercel.json`.
- [x] Screenshots of landing, Costs, Sessions, a transcript, Settings, a refused save, both Orgs and the switcher at 1440x900 and 390x844 in light and dark. Kept in the build session's scratch directory, not in the repo; commit `0a803d4` fixed what they showed.
- [x] Migration `20260925160000_live_demo.sql` run on production (Taha, 2026-09-25).
