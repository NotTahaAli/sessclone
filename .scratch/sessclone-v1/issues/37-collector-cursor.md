# 37: Collector — cursor and incremental push

**What to build:** Steady-state reporting costs a few hundred bytes: only Turns past the cursor are sent, not the session so far.

**Blocked by:** 06, 33.

**Status:** done

- [x] Cursor records the last acknowledged position, stored at the per-environment location the spike identified
- [x] A routine report sends only new Turns
- [x] A deleted or corrupt cursor causes re-reporting, never loss
- [x] Nothing is sent when the transcript has not grown

**How it landed:** `packages/plugin/src/cursors.mjs` keeps one cursor per transcript under `<state dir>/cursors/`, written atomically and only after the deployment accepted the report carrying it. `report.mjs` reads each file from its cursor rather than from the top, so an unchanged transcript produces no request at all. A cursor that is absent, unparseable, the wrong shape, or past the end of a replaced file means "read from the top": every failure here costs bandwidth and none costs a Turn.
