# 06 — Spike: local install paths and per-environment state

Where Claude Code keeps config and transcripts on macOS, Linux and Windows, and
where the Collector may put its own cursor file and retry queue. Verified in
Claude Code 2.1.269 (this box: `/opt/claude-code/bin/claude`, a Bun-compiled
binary — `strings` on it recovers the bundled JS source nearly verbatim).

## Table

| Platform | Claude config dir                                   | Claude transcripts                                      | Proposed Collector state dir                              | Evidence grade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | --------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux    | `$CLAUDE_CONFIG_DIR` or `~/.claude`                 | `<config dir>/projects/<sanitized-cwd>/<session>.jsonl` | `$XDG_STATE_HOME/sessclone` or `~/.local/state/sessclone` | **observed here** (config dir, transcripts, no XDG involvement in Claude's own resolution) + inferred (Collector dir is our own choice, following the XDG Base Directory spec, not a Claude Code path)                                                                                                                                                                                                                                                                                                                                                                           |
| macOS    | `$CLAUDE_CONFIG_DIR` or `~/.claude` (`~` = `$HOME`) | `<config dir>/projects/<sanitized-cwd>/<session>.jsonl` | `~/Library/Application Support/sessclone`                 | **documented by Anthropic** at https://code.claude.com/docs/en/claude-directory and https://code.claude.com/docs/en/env-vars (config dir + `CLAUDE_CONFIG_DIR` semantics; transcript layout is the same page family as Linux, not macOS-specific) + inferred (Collector dir follows Apple's documented per-user Application Support convention, not observed)                                                                                                                                                                                                                    |
| Windows  | `%CLAUDE_CONFIG_DIR%` or `%USERPROFILE%\.claude`    | `<config dir>\projects\<sanitized-cwd>\<session>.jsonl` | `%LOCALAPPDATA%\sessclone`                                | **documented by Anthropic** at https://code.claude.com/docs/en/claude-directory ("`~/.claude` resolves to `%USERPROFILE%\.claude`") + **inferred from the CLI's own code** for `LOCALAPPDATA` as the right per-user, no-elevation Windows directory — the same binary uses `process.env.LOCALAPPDATA` (Chrome-bridge module, `/opt/claude-code/bin/claude`, string `a.LOCALAPPDATA`) to locate its own per-user app data on Windows, and the docs separately list `%LOCALAPPDATA%` among the env vars Claude Code itself expands in path settings (`docs/en/settings-reference`) |

## Runtime resolution rule for the Collector

Resolve `CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")` exactly as Claude
Code does — needed only to _find_ transcripts to read, never to _write_ into.
For the Collector's own cursor and retry queue, resolve a **separate**,
platform-native per-user state directory, never a path under Claude's config
dir:

```
if (env.SESSCLONE_STATE_DIR) → that path (explicit override, all platforms)
else if (platform === 'win32')  → env.LOCALAPPDATA + '\sessclone'
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

This spike stays **open** per the ticket until run on real hardware:

- **macOS**: nothing here was run on a Mac. The macOS row rests entirely on
  Anthropic's docs plus the fact that the resolution code (`homedir()` +
  `".claude"`, no OS branching) is identical to the Linux code path we
  observed running — `os.homedir()` on macOS returns `$HOME` per Node/Bun's
  own contract, so the same function should produce `~/.claude`, but this was
  not run and watched. **Verifies with:** install Claude Code on a Mac, run a
  session, `ls ~/.claude/projects`, and check `echo $CLAUDE_CONFIG_DIR` is
  unset in a normal shell.
- **Windows**: same gap, sharper — Windows is the one platform where the
  underlying primitive changes (`os.homedir()` reads `USERPROFILE`, not
  `HOME`), and where the Collector's proposed `%LOCALAPPDATA%` directory was
  never observed to exist, be writable, or survive anything. The
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
