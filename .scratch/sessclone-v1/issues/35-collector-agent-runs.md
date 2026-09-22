# 35: Collector — agent runs

**What to build:** Work delegated to subagents stops being invisible: every Agent Run is reported, workflow runs included.

**Blocked by:** 33.

**Status:** done

- [x] Agent Run Turns read from the agent's own transcript, not the parent's
- [x] Workflow Agent Runs collected on the same path, with no special case
- [x] Each Agent Run attributed to its parent Session
- [x] Spawn depth read from the sidecar rather than assumed

**How it landed:** `packages/plugin/src/transcripts.mjs` searches the config directory for every transcript of the Session — its own file and `<sessionId>/subagents/agent-*.jsonl` beside it — and `report.mjs` builds one report per identity, reading each run's Turns from the run's own transcript and grouping them by the `agentId` its entries carry. A workflow's run is the same path with no special case, proven by using `workflow-agent-run.jsonl` as one of the two runs in the tests. Spawn depth is read from the `agent-<id>.meta.json` sidecar, stays null when the sidecar states none, and now travels on the wire (`ReportedTurn.spawnDepth`) into `turns.spawn_depth`.
