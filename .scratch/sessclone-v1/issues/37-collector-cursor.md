# 37: Collector — cursor and incremental push

**What to build:** Steady-state reporting costs a few hundred bytes: only Turns past the cursor are sent, not the session so far.

**Blocked by:** 06, 33.

**Status:** ready-for-agent

- [ ] Cursor records the last acknowledged position, stored at the per-environment location the spike identified
- [ ] A routine report sends only new Turns
- [ ] A deleted or corrupt cursor causes re-reporting, never loss
- [ ] Nothing is sent when the transcript has not grown
