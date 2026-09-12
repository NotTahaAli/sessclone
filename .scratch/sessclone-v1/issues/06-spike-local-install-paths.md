# 06: Spike — local install paths and per-environment state

**What to build:** An answer: where Claude Code keeps its configuration and transcripts on macOS, Linux, and Windows, and where the Collector may keep its cursor and queue on each.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Paths confirmed on all three operating systems, not assumed
- [x] A writable per-environment state location identified on each
- [x] Findings note records path resolution rules for tickets 37 and 39

**Partially done — stays open.** `docs/findings/06-install-paths.md` grades every
row by evidence: Linux is observed on a real box, macOS and Windows rest on
Anthropic's documentation plus the installed CLI's own path-resolution code. The
first criterion says "not assumed", so it stays unticked until someone runs this
on a real Mac and a real Windows machine.

One finding is load-bearing regardless of platform: everything under
`~/.claude/projects/` is deleted by Claude Code's own `cleanupPeriodDays` sweep,
30 days by default. Transcripts have an expiry date, which is a deadline on
archival and a reason the Collector must never keep its own state in there.
