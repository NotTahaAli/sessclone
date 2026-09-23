# 101: Archive agent sidecars and workflow journals

**What to build:** Taha, 2026-09-23: "I want a session transcript viewer, which shows when a subagent started, and a side pane for the subagent transcript in it, if there are multiple depths, keep increasing subpanes. Just like the MacOS finder Columns view, Horizontally Scrollable." A subagent's type, description and the tool call that spawned it live in `agent-<id>.meta.json` beside its transcript, and which agents belong to a workflow run lives only in `subagents/workflows/<runId>/journal.jsonl`. The Collector archived neither, so the viewer could not group a workflow's agents. Found 2026-09-23 by running a two-agent workflow and reading what Claude Code wrote.

**Where the ask forks, and what was picked (Taha's picks).**

- Collector archives both, through the same presign and confirm routes and the same opt-in gates, as a new `kind` of Log Artifact (`agent_meta`, `workflow_journal`).
- Every existing list of transcripts ignores the new kinds; deleting a transcript deletes its sidecars.

**Blocked by:** —

**Status:** todo

- [ ] `kind` on the presign and confirm wire contracts, defaulting to `transcript` so older Collectors keep working
- [ ] Migration adding `log_artifacts.kind`, unique key including it
- [ ] Collector enumerates and archives sidecars and journals
- [ ] Lists filter by kind; delete and retention sweep remove sidecars
- [ ] Self-hosting docs: the bucket must allow CORS GET with `Range`
