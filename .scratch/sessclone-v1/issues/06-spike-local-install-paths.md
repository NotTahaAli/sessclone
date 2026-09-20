# 06: Spike — local install paths and per-environment state

**What to build:** An answer: where Claude Code keeps its configuration and transcripts on macOS, Linux, and Windows, and where the Collector may keep its cursor and queue on each.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Paths confirmed on all three operating systems, not assumed
- [x] A writable per-environment state location identified on each
- [x] Findings note records path resolution rules for tickets 37 and 39

**Done.** `docs/findings/06-install-paths.md` now grades every row on real
hardware. Linux was always observed. macOS was run directly (27.0, Claude Code
2.1.275): config dir, transcript layout, `homedir() === $HOME`, no `XDG_*`, and
`~/Library/Application Support/sessclone` created, written and removed. Windows
came from a real box's `%USERPROFILE%\.claude` — 52 Sessions and 149 Agent Runs
at 2.1.220 — with `%LOCALAPPDATA%\sessclone\probe` confirmed writable and
persistent by that machine's operator, which the finding grades as testimony
rather than as its own observation.

The load-bearing finding is unchanged: everything under `~/.claude/projects/`
is deleted by Claude Code's own `cleanupPeriodDays` sweep, 30 days by default,
so transcripts have an expiry date and the Collector must keep its state
elsewhere. macOS added the proof it actually runs — a `.last-cleanup` file with
a timestamp in it.

Four findings that belong to other tickets came out of the two new machines:

- **The sanitised project directory name is lossy** (`/`, `\` and `:` all
  become `-`, drive letter lowercased, case otherwise preserved) and cannot be
  reversed to a path. Read `cwd` off an entry instead — tickets 30 and 36.
- **Agent Run transcripts nest under the Session**, at
  `<session-uuid>/subagents/agent-<agentId>.jsonl`, on both macOS and Windows.
  A flat `projects/*/*.jsonl` glob misses every one of them — ticket 36. All
  149 Windows Agent Runs carried the parent's `sessionId` beside their own
  `agentId`, which is ADR 0006's key holding at scale.
- **`spawnDepth` lives in a sidecar `.meta.json`, not in the transcript**, is
  nullable, and reaches 2 with a `parentAgentId` link — tickets 35 and 36. Some
  Agent Runs also run in a git worktree on their own branch, reporting a `cwd`
  that is not the Session's, which is an argument for keying Projects on the
  normalised git remote — ticket 30.
- **One directory produced two `cwd` spellings** on one machine (`c:\` on 1,125
  entries, `C:\` on 281), and `meta.json`'s `model` is an alias rather than an
  id. Two usage-bearing entries carried `message.model: "<synthetic>"`, which
  is exactly the unpriceable model ADR 0002's "null, never zero" exists for.
