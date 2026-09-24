# 125: Costs columns list Sessions and open with a token table

**What to build:** Taha, 2026-09-23. Every Costs column (a person, a Project, a Device, a model, a day, and the standalone `/costs/[dimension]/[id]` page) lists that cut's Sessions, not its Turns, and opens with its tokens by class. Outside the Session view, counts read "N sessions", not "N turns".

**Where the ask forks, and what was picked.**

- The Sessions are `sessionList`, the Sessions page's own statement, narrowed to the cut: new `deviceId` and `model` filters beside `projectId` and `memberId`. It reads the listed shelf, so an archived Session's spend is in the totals and not in the list, as on the Sessions page.
- Each column is one aggregate for the tokens (`lib/tokens.ts`) and one page of Sessions, both on `turns_org_occurred_at_idx`.
- Cache write is one class: the reported creation total, priced at its 5m and 1h Rates.
- Non-model cuts add a compact table by model, which scrolls sideways at 390px.
- The Session view still counts Turns, where "1 session" would say nothing.

**Blocked by:** 122.

**Status:** done

- [x] `tokenBreakdown`, one statement, unit-tested as `sessclone_app`
- [x] `dailySpend` and `breakdown` count distinct Sessions
- [x] `sessionList` device and model filters
- [x] Devices count Sessions in the last 30 days
- [x] Screenshots at 1440 and 390, light and dark
