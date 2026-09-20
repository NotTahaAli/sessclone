# 74: Spike — Claude Projects session identity and Device handle

**What to build:** An answer to the two questions that decide whether Claude
Projects can be collected at all: what a Session is when the container it ran in
is reclaimed, and what a Collector running inside one can read that names the
environment rather than the container.

**Blocked by:** None (can start immediately).

**Status:** needs-info

- [x] Transcript location and format in a Projects environment confirmed against a live session, not assumed from Claude Code Cloud
- [ ] States whether a resumed thread keeps its `sessionId` and appends, or starts a new transcript for one continuing conversation
- [x] Names every stable identifier a hook process can read, and says plainly which are per-container
- [x] Records which hook events fire, `Stop` among them, and what that leaves exposed in place of `SessionEnd`
- [x] Findings note records what tickets 75 and 76 need from it

**Answer, minus one criterion:** `docs/findings/74-claude-projects.md`. Claude
Projects runs the same CLI writing the same transcripts in the same place, so
the parser, the schema, the ingest contract and ADR 0006 hold unchanged — the
2.9x `apiBlockIndex` overcount reproduces exactly, and ticket 75's fixture is
the evidence. `Stop` fires, which makes `SessionEnd` close to irrelevant here
given finding 05. Nothing a hook process can read names the environment:
`/etc/machine-id` is per-container, the obvious variables are empty, and the
stable `environment_id` is reachable only from inside the session. That gap is
ticket 76.

**The second criterion is why this is `needs-info`.** Whether a reclaimed
container's conversation resumes under its old `sessionId` or starts a new
transcript cannot be observed from inside one container's lifetime. It needs a
capture across a real reclaim. Until someone has it, expect a Projects
conversation to span more than one Session.
