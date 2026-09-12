# 35: Collector — agent runs

**What to build:** Work delegated to subagents stops being invisible: every Agent Run is reported, workflow runs included.

**Blocked by:** 33.

**Status:** ready-for-agent

- [ ] Agent Run Turns read from the agent's own transcript, not the parent's
- [ ] Workflow Agent Runs collected on the same path, with no special case
- [ ] Each Agent Run attributed to its parent Session
- [ ] Spawn depth read from the sidecar rather than assumed
