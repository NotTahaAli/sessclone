# 39: Collector — retry, queue, and sweep

**What to build:** Nothing is lost to a dropped connection: reports retry, then queue, and the next Session in that environment sweeps up whatever is outstanding.

**Blocked by:** 05, 06, 36, 37, 38.

**Status:** ready-for-agent

- [ ] Three retries at increasing delays before the queue is touched
- [ ] A queued report drained by the next session start in that environment
- [ ] The sweep re-reports every Session not known to be complete, in full
- [ ] The sweep backfills Turns from before a plugin install took effect
- [ ] Behaviour proven with faked time and transport, so no test waits on a real delay
- [ ] The residual gap is documented where a user will see it, not only in the spec
