# 38: Collector — session end

**What to build:** A Session's final Turns are flushed when it ends, and the Session is marked complete so later sweeps know not to re-read it.

**Blocked by:** 05, 33, 37.

**Status:** ready-for-agent

- [ ] Final flush on session end, covering Turns after the last routine report
- [ ] Completeness recorded, and the ticket states plainly whether that record is local or server-side and what the choice costs when a container dies
- [ ] Behaviour under a killed container matches what the spike found, or the gap is documented
