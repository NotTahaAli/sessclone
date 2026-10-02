# sessclone

The SessClone Collector. It reports your Claude Code usage (tokens, models,
cost inputs, timings) to a SessClone deployment, so you and your Org can see
spend per person, Project, Device and Session on the dashboard.

## Install

```
/plugin marketplace add NotTahaAli/sessclone
/plugin install sessclone@sessclone
```

Claude Code asks for two things, both optional:

- **API key**: create one in the dashboard under **Keys**. It is shown once and
  kept in Claude Code's secure credential store, not in `settings.json`. Leave it empty in a Claude Code
  cloud environment whose SessClone API credential adds it.
- **Deployment URL**: leave it empty for the hosted service at
  `https://sessclone.com`. Self-hosted deployments enter their own address.

Restart Claude Code. The next session says whether it connected, and which
Org it reports to. Turns from before the install are backfilled from the
transcripts Claude Code still keeps.

Requires Node 22.18 or newer (or 23.6+, or 24).

## Commands and the status bar

- `/sessclone-status` shows what the last session start found: the
  deployment, the key's first three characters and length, whether it was
  accepted and for which Org, plus this Device, how many of this session's
  Turns are not sent yet, what is waiting to send and the last push.
- `/sessclone-sync` sends everything waiting now, without a Claude turn, and
  says what it sent.
- A line above the prompt shows whether the key is connected, whether this
  session is synced or how many Turns it is behind, what is queued, and `↗`,
  which opens this session in the dashboard.

These are the plugin's mod (`hooks/register.tsx`), which needs Claude Code
2.1.287 or newer. Where mods cannot load, `/sessclone:status` and
`/sessclone:sync` do the same: status reads what the hooks recorded, and sync
is carried out by the hook that ends that turn.

## What it sends, and where

Everything goes over HTTPS to the deployment URL above, with your key as a
bearer token, except the opt-in transcript upload described last.

- **Session start (`SessionStart`):** `GET /api/ingest` to ask whether the key
  is accepted and for which Org. If it is not, the plugin says so and sends
  nothing else until a session starts with a key that is. Then it re-sends
  what an earlier session could not (`POST /api/ingest`).
- **Every turn (`Stop`):** `POST /api/ingest` with, per Turn, the token counts
  by kind, the model, timings, the Session, Project and Device it belongs to,
  the working directory, the git branch, and the git remote reduced to a
  Project key. No prompt, no reply, no file contents.
- **Session events (`StopFailure`, `SessionEnd`):** `POST /api/ingest` saying
  that a turn ended on an API error, or that a session ended.
- **Transcripts, only if you opt in:** the raw session transcript, which does
  contain prompts and code, is uploaded only when your Member settings on the
  deployment turn transcript upload on. It is off by default. The plugin asks
  the deployment for an upload URL (`POST /api/logs/presign`), uploads the
  compressed transcript to that URL, which is the deployment's object storage
  (Supabase Storage for the hosted service), and confirms it
  (`POST /api/logs/confirm`). Your Org's retention removes it.

## What it reads and runs locally

- Claude Code's own transcripts under `~/.claude/projects/` (or
  `CLAUDE_CONFIG_DIR`), from a cursor, so each turn costs a few hundred bytes.
- `git` in the session's working directory, to read the branch and remote.
- A state directory for cursors, the retry queue, and the last key check
  (`~/.local/state/sessclone`, `~/Library/Application Support/sessclone`, or
  `%LOCALAPPDATA%\sessclone`).
- When `HTTPS_PROXY` is set, each hook restarts itself once under Node's own
  proxy support so its requests go through that proxy.

The API key is read only from the plugin's setup prompt, never from your shell
environment, and never written to a log, a file or a transcript.

## Settings

| Setting             | Where                         | Default                  |
| ------------------- | ----------------------------- | ------------------------ |
| API key             | setup prompt (`api_key`)      | none, optional in cloud  |
| Deployment URL      | setup prompt, `SESSCLONE_URL` | `https://sessclone.com`  |
| State directory     | `SESSCLONE_STATE_DIR`         | per platform, see above  |
| Device name         | `SESSCLONE_DEVICE`            | derived from the machine |
| Print hook failures | `SESSCLONE_DEBUG=1`           | off                      |

To change an answer, run `/plugin configure sessclone` and start a new session.

## Source and license

Readable source, no build step: the hooks in `hooks/` run as `node <file>.mjs`
and import the modules in `src/`. MIT licensed, see `LICENSE`. Project home and
issues: https://github.com/NotTahaAli/sessclone
