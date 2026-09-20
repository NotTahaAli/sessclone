# 06 — Spike: local install paths and per-environment state

Where Claude Code keeps config and transcripts on macOS, Linux and Windows, and
where the Collector may put its own cursor file and retry queue.

Three passes, three machines. The original run was Claude Code 2.1.269 on a
Linux box (`/opt/claude-code/bin/claude`, a Bun-compiled binary — `strings` on
it recovers the bundled JS source nearly verbatim), with macOS and Windows
resting on documentation. Both have since been run on real hardware: macOS
27.0 with Claude Code 2.1.275, and a Windows box's own `.claude` tree at
2.1.220. Each row of the table below says which grade it holds.

## Table

| Platform | Claude config dir                                   | Claude transcripts                                      | Proposed Collector state dir                              | Evidence grade                                                                                                                                                                                                                                                                                   |
| -------- | --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Linux    | `$CLAUDE_CONFIG_DIR` or `~/.claude`                 | `<config dir>/projects/<sanitized-cwd>/<session>.jsonl` | `$XDG_STATE_HOME/sessclone` or `~/.local/state/sessclone` | **observed here** (config dir, transcripts, no XDG involvement in Claude's own resolution) + inferred (Collector dir is our own choice, following the XDG Base Directory spec, not a Claude Code path)                                                                                           |
| macOS    | `$CLAUDE_CONFIG_DIR` or `~/.claude` (`~` = `$HOME`) | `<config dir>/projects/<sanitized-cwd>/<session>.jsonl` | `~/Library/Application Support/sessclone`                 | **observed on a real Mac** — see "macOS, measured" below. Config dir, transcript layout, `homedir() === $HOME`, no `XDG_*` present, and the Collector's proposed state dir created and written                                                                                                   |
| Windows  | `%CLAUDE_CONFIG_DIR%` or `%USERPROFILE%\.claude`    | `<config dir>\projects\<sanitized-cwd>\<session>.jsonl` | `%LOCALAPPDATA%\sessclone`                                | **config dir and transcript layout observed** on a real Windows box — see "Windows, measured" below, 52 Sessions and 149 Agent Runs from Claude Code 2.1.220. The Collector state dir **confirmed by the operator** on that box: `%LOCALAPPDATA%\sessclone\probe` is writable and is not removed |

## macOS, measured

The table's macOS row was documentation and inference until this run. It is now
observed, on macOS 27.0 (build 26A428, arm64), Claude Code **2.1.275** as
reported by the transcript's own `version` field.

| Claim                           | What was seen                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Config dir                      | `CLAUDE_CONFIG_DIR` unset; `~/.claude` exists and holds `projects/`, `settings.json`    |
| `~` is `$HOME`                  | `$HOME` and `os.homedir()` both `/Users/<user>`; `process.platform === 'darwin'`        |
| Transcript path                 | `~/.claude/projects/<sanitized-cwd>/<session-uuid>.jsonl`, 12 project directories       |
| No XDG involvement              | No `XDG_*` variable set at all, as on Linux                                             |
| Collector state dir is writable | `~/Library/Application Support/sessclone-probe` created, written, read back, removed    |
| The sweep runs                  | `~/.claude/.last-cleanup` holds an ISO timestamp; `cleanupPeriodDays` unset, so 30 days |

`.last-cleanup` is new evidence and it is the good kind: the sweep is not a
documented intention, it is a thing with a timestamp on disk. The archival
deadline is real on macOS too.

### Two findings that change other tickets

**1. The sanitised directory name is lossy, so it cannot be reversed to a cwd.**
`/Users/<user>/Documents/Projects/NotTahaAli/sessclone` becomes
`-Users-<user>-Documents-Projects-NotTahaAli-sessclone`: every `/` becomes `-`,
the leading `/` becomes a leading `-`, and **case is preserved** (`NotTahaAli`
survives; the lowercase home directory was already lowercase). Because a real
path segment may itself contain a dash — this machine has
`-Users-<user>-Documents-Projects-LootBun-BloxfruitsBot` — the mapping is
one-way. Nothing may parse a project directory name back into a working
directory. Read `cwd` off an entry instead, which every entry carries. This
matters to tickets 30 and 36.

**2. Agent Run transcripts nest under the Session id, not beside it.** On this
client the layout is:

```
<config>/projects/<sanitized-cwd>/<session-uuid>.jsonl          the Session
<config>/projects/<sanitized-cwd>/<session-uuid>/               a directory, same name
    custom-title.json
    subagents/agent-<agentId>.jsonl                             the Agent Run
    subagents/agent-<agentId>.meta.json
```

Confirmed against a subagent spawned during this session: its `agentId`
matched the filename, and the transcript's first entry carried the **parent's**
`sessionId` beside its own `agentId`, plus `isSidechain: true` and
`entrypoint: claude-desktop`. That is ADR 0006's identity key holding on a
second platform and a newer Claude Code than the fixtures came from.

The `.meta.json` is the surprise, and ticket 35 wants it: `spawnDepth` lives
**there**, not in the transcript, alongside `agentType`, `model`, `toolUseId`,
`requestShape` and `requestNonInteractive`. The spec says the Collector stores
each Agent Run's reported spawn depth rather than assuming one level — this is
where that number actually is. The observed run read `spawnDepth: 1`.

A `glob` of `projects/*/**/*.jsonl` finds Session and Agent Run transcripts
alike, which is what ticket 36 needs; a flat `projects/*/*.jsonl` misses every
Agent Run on this client.

**Caution on `.meta.json`:** its `description` field is the prompt the parent
sent the subagent. It is content, and the Collector must never send it.

### One version trap

`claude --version` on this machine reports **2.1.267** while the running
desktop client writes `version: 2.1.275` into its transcripts. Two builds, one
machine. The Turn's client version must be read from the transcript entry,
never from shelling out to the CLI — they disagree today, on this box.

## Windows, measured

A copy of a real Windows box's `%USERPROFILE%\.claude` tree, one project:
**52 Session transcripts and 149 Agent Runs**, Claude Code 2.1.220. It settles
the layout question and then keeps going — this corpus is the largest sample
any spike here has had, and it contradicts two assumptions.

| Claim           | What was seen                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Config dir      | The tree's root is `%USERPROFILE%\.claude`, as documented                                      |
| Project dir     | `c--Users-<user>-Documents-BloxfruitsBot` for `C:\Users\<user>\Documents\BloxfruitsBot`        |
| Transcript path | `<config>\projects\<sanitized-cwd>\<session-uuid>.jsonl`; the filename uuid is the `sessionId` |
| Agent Run path  | `<session-uuid>\subagents\agent-<agentId>.jsonl`, same nesting as macOS                        |
| Entry version   | `2.1.220` on all 1,406 entries sampled                                                         |
| Entrypoints     | `claude-vscode` (1,372) and `cli` (34) — one project, two clients                              |

**Sanitisation, Windows form.** `:` and `\` both become `-`, so `C:\Users` gives
`c--Users` — note the doubled dash, and note that the **drive letter is
lowercased** while every other segment keeps its case (`Documents`,
`BloxfruitsBot`). Combined with the macOS rule, the mapping is: replace each of
`/`, `\` and `:` with `-`, lowercase the drive letter only. It stays lossy in
both directions — a real segment may contain a dash — so nothing may reverse a
project directory name into a path.

### The identity key, checked at scale

**149 of 149 Agent Runs** had `sessionId` equal to the parent directory's uuid
_and_ `agentId` equal to the filename's, with `isSidechain: true`. That is ADR
0006's `(session_id, agent_id, …)` key holding on a third platform, a different
client, and a Claude Code five minor versions from the one the fixtures came
from.

### Three things that change other tickets

**1. One directory produces two `cwd` spellings.** The same project appears as
`c:\Users\<user>\Documents\BloxfruitsBot` on 1,125 entries and
`C:\Users\<user>\Documents\BloxfruitsBot` on 281 — same machine, same version,
differing only in the drive letter's case. Anything keying a Project or a
Device on a raw `cwd` string gets two of them. Ticket 30 must case-fold the
drive letter (and, on Windows, treat the path case-insensitively) before the
`local:` fallback key is computed. This is not hypothetical; it is 281 entries.

**2. Agent Runs nest more than one level, and the tree is recoverable.** One
meta carries `spawnDepth: 2` **and** `parentAgentId`, pointing at the agent
that spawned it. So the spec's "store the reported spawn depth rather than
assuming one level" is right, and there is a parent link to store beside it.
`spawnDepth` is absent on 2 of 149, so it is nullable in practice.

Two metas also carry `worktreePath` and `worktreeBranch`
(`<project>\.claude\worktrees\agent-<id>`), one of them with a `cwd` pointing
inside the worktree. An Agent Run can therefore report a working directory that
is not the Session's, on a branch that exists only for that agent — while being
the same repository. That is an argument for ticket 30 keying Projects on the
normalised git remote rather than on a path, and a trap for anything that
assumes an Agent Run shares its parent's cwd.

**3. `meta.json`'s `model` is an alias and must never price anything.** It
reads `sonnet` (69), `opus` (34), `haiku` (10), absent (28), and only 8 times a
real id. The usage-bearing entries carry the real ones: `claude-opus-5` (8,200),
`claude-sonnet-5` (3,910), `claude-fable-5` (573),
`claude-haiku-4-5-20251001` (519). Finding 07 already said to take
`message.model`; this is why. An alias cannot join to a Rate row.

And the corpus contains the case ADR 0002 was written for: **2 usage-bearing
entries whose `message.model` is `<synthetic>`**. Not a model, not priceable,
and real. A Cost path that maps an unknown model to zero would silently bill
those at nothing; the ADR's "null, never zero" is the behaviour that survives
contact with this data.

### Not turned into fixtures

### The Collector's state directory on Windows

`%LOCALAPPDATA%\sessclone\probe` was written on that machine and **persisted**
— it is writable without elevation and nothing removes it.

Grading this honestly: that is the box's operator reporting a result, not
something this spike ran and watched, which is a weaker grade than the macOS
probe above (created, written, read back, removed, in one command). It is
first-hand testimony about the real platform rather than inference from
documentation, and it is the last claim the Windows row needed, so the row is
no longer inference — but it is testimony, and the file should say so rather
than quietly promote it to "observed".

Nothing here changes the resolution rule below, which already prefers
`LOCALAPPDATA` with a `%USERPROFILE%\AppData\Local` fallback.

### Not turned into fixtures

Deliberately. Every `cwd` here contains a real username and the `description`
in each `.meta.json` is the prompt text sent to a subagent. The corpus README
already warns that `cwd` and `gitBranch` pass the redactor verbatim, so these
files cannot be committed as-is. A Windows fixture and a depth-2 Agent Run
fixture are both worth having, and both need the redactor extended to cover
`cwd`, `worktreePath` and `description` first — that is ticket 08's call, not
this spike's.

## Runtime resolution rule for the Collector

Resolve `CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")` exactly as Claude
Code does — needed only to _find_ transcripts to read, never to _write_ into.
For the Collector's own cursor and retry queue, resolve a **separate**,
platform-native per-user state directory, never a path under Claude's config
dir:

```
if (env.SESSCLONE_STATE_DIR) → that path (explicit override, all platforms)
else if (platform === 'win32')  → join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'sessclone')
else if (platform === 'darwin') → homedir() + '/Library/Application Support/sessclone'
else                             → env.XDG_STATE_HOME ?? (homedir() + '/.local/state') , + '/sessclone'
```

Each of these is per-user (keyed off `HOME`/`USERPROFILE`/`LOCALAPPDATA`, never
a machine-wide path), requires no elevation to create or write, and is
untouched by anything Claude Code itself manages — it isn't `~/.claude` at
all, so it can't fall inside Claude's own `cleanupPeriodDays` sweep (see
below) or get wiped by `CLAUDE_CONFIG_DIR=/tmp/...` debugging tricks. `mkdir
-p` on first run makes it survive a Collector upgrade (a version bump reuses
the same directory; nothing about it is versioned into the install path).

### Why not just live under `~/.claude`

Confirmed via Context7 (`code.claude.com/docs/en/claude-directory`, "Cleaned
up automatically"): everything under `~/.claude/projects/<project>/` —
including the `.jsonl` transcripts themselves — is deleted once older than
`cleanupPeriodDays` (default 30, user-configurable down to 1, org-managed
settings can force a value). That single fact rules out `~/.claude/...` for
the Collector's cursor/queue outright, independent of the "don't write into a
tool's own directory" instinct: a cursor file placed there would be quietly
deleted out from under the Collector on a schedule the Collector doesn't
control.

## What was measured directly on this Linux box

- `~/.claude` (`$HOME=/root` here) exists and holds `projects/`, `settings.json`,
  `plugins/`, `skills/`, `agents/`, `sessions/`, etc. — matches the documented
  layout exactly.
- No `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, or `XDG_CACHE_HOME`
  are set in this session's environment, and Claude Code's own config-dir
  resolution (recovered from the binary, see below) never reads any `XDG_*`
  variable — only `CLAUDE_CONFIG_DIR` and `os.homedir()`. The `XDG_STATE_HOME`
  string does appear in the binary, but only inside `CLAUDE_CODE_FEDERATION_CACHE_DIR`
  documentation text and third-party bundled tooling (ripgrep, git), not in
  Claude's own config-dir path.
- `strings -a` on `/opt/claude-code/bin/claude` (a Bun single-file executable —
  confirmed by its `/$bunfs/root/chunk-*.js` internal import paths) recovers
  the literal bundled source. The exact resolution function:

  ```js
  function s() {
    return process.env.CLAUDE_CONFIG_DIR
  }
  var Se = hs(() => (s() ?? a(R(), '.claude')).normalize('NFC'), s)
  // R = os.homedir, a = path.join — imported a few lines above as:
  // import{homedir as R}from"os";import{...,join as a,...}from"path";
  ```

  and the transcripts directory is built directly on top of it:

  ```js
  function nc() {
    return u(Se(), 'projects')
  } // path.join(configDir, "projects")
  ```

  A separate bundled help string spells the full transcript path pattern
  verbatim: `` Session transcripts live at `~/.claude/projects/<sanitized-cwd>/*.jsonl` ``.

- `which claude` → `/opt/node22/bin/claude`, a symlink to `/opt/claude-code/bin/claude`.

## Documentation used (Context7, `/anthropics/claude-code` and `/websites/code_claude`)

- `docs/en/claude-directory` — `.claude` directory contents, the Windows
  `%USERPROFILE%\.claude` mapping, and the full "cleaned up automatically"
  table (this is where `cleanupPeriodDays` and its default/minimum come from).
- `docs/en/env-vars` — `CLAUDE_CONFIG_DIR` description ("default: `~/.claude`.
  All settings, session history, and plugins are stored under this path").
- `docs/en/settings-reference` — confirms `HOME`, `TMPDIR`/`TMP`/`TEMP`, and
  the whole `XDG_*` family are _operating-system_ directory variables Claude
  Code treats specially (project/local settings can't override them), and
  lists `%LOCALAPPDATA%`/`%APPDATA%` as Windows path variables Claude Code
  itself expands — the basis for treating `%LOCALAPPDATA%` as the credible
  per-user Windows app-data root for the Collector too.
- `examples/mdm/windows/Set-ClaudeCodePolicy.ps1` (in the Context7 corpus) —
  org-wide `managed-settings.json` lives at
  `C:\Program Files\ClaudeCode\managed-settings.json`, i.e. machine-wide and
  admin-written, not per-user — confirms the per-user config lives elsewhere
  (`%USERPROFILE%\.claude`), which is the path this note recommends against
  reusing for Collector state.

## What is still unverified, and what would verify it

All three platforms have now been checked on real hardware, so the spike is
**closed**. The two entries below are kept as a record of what was checked and
at what grade, not as outstanding work.

- ~~**macOS**~~ — **closed.** Run on a real Mac; see "macOS, measured" above.
  Every claim in the macOS row was checked directly rather than inferred from
  the Linux code path, and the run turned up three things the inference would
  never have produced: the lossy directory-name sanitisation, the
  `subagents/` nesting with `spawnDepth` in a sidecar `.meta.json`, and a CLI
  binary whose version disagrees with the client writing the transcripts.
- ~~**Windows**~~ — **closed**, in two halves with two evidence grades. The
  config dir and the transcript layout are observed directly from a real box's
  `%USERPROFILE%\.claude` (52 Sessions, 149 Agent Runs; see "Windows,
  measured"). The Collector's own `%LOCALAPPDATA%\sessclone` directory is
  confirmed writable and persistent by that box's operator rather than by this
  spike. The original reasoning is kept below because it is what the claim
  rested on before either check, and because the distinction it draws is still
  right: the
  `LOCALAPPDATA` usage cited above is Claude Code's _own_ Chrome-integration
  code reading that variable for a different purpose (finding installed
  browsers), not proof of how a third-party tool like the Collector should
  lay out its own state — it only establishes that `%LOCALAPPDATA%` is a
  variable Claude Code's own code trusts as present and per-user on Windows.
  **Verifies with:** install Claude Code on Windows, run a session, confirm
  `%USERPROFILE%\.claude\projects` exists; separately write a throwaway file
  to `%LOCALAPPDATA%\sessclone\probe` and confirm it persists across a
  `winget upgrade`/reinstall of some other package (as a proxy for "survives
  an upgrade") and across a Claude Code `cleanupPeriodDays` sweep (it should
  be untouched, since it isn't under `.claude` at all).
- **`cleanupPeriodDays` interaction, unobserved end-to-end**: confirmed from
  docs that the sweep deletes aged transcripts under `~/.claude/projects`, but
  this session did not force `cleanupPeriodDays: 1` and watch a transcript
  actually get deleted. **Verifies with:** set `cleanupPeriodDays: 1` in
  `~/.claude/settings.json`, touch a project transcript's mtime to 2+ days
  old, start a new session, and check the old `.jsonl` is gone.
- **Windows shell quoting / path separator handling** in whatever language the
  Collector ships in was not exercised at all — this note only establishes
  _which_ directory, not that a given implementation joins paths correctly
  there.
