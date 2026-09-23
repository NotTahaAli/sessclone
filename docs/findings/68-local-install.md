# 68 — Manual verification: local install

A fresh install on a real macOS, a real Linux and a real Windows machine, each
running real Claude Code. Nothing here can be automated: automating it would
mean automating Claude Code.

What **is** automated is the reading. `node scripts/verify-collector.mjs`
gathers everything the checkboxes below ask about — the Node version, the
resolved state directory, the cursor and queue files as they actually landed,
the Device key, and the transcripts on disk — and prints it as a block to paste
into this file. The operator's part is: install, restart, work one ordinary
session, run the command.

## Per machine

```
/plugin marketplace add NotTahaAli/sessclone
/plugin install sessclone
# answer the two prompts: the deployment URL, then the API key
# restart Claude Code, then one ordinary session, then:
node scripts/verify-collector.mjs
```

The prompts are the supported path; `SESSCLONE_URL` and `SESSCLONE_API_KEY`
remain as an override for an environment with no prompt to answer.

The script prints the key's first three characters and its length, never more
(`keyEvidence`), because the output is pasted into a chat and a hook's stderr
lands in a transcript this product uploads.

Run it from a clone of the repository. An install carries `packages/plugin`
alone — no `scripts/`, and no `node_modules` — which is the same fact that made
the plugin's first release collect nothing at all (PR #12).

## Results

| Machine | OS            | Claude Code | Node   | Turns arrived | State directory as resolved                         |
| ------- | ------------- | ----------- | ------ | ------------- | --------------------------------------------------- |
| macOS   | Darwin 27.0.0 | 2.1.267     | 26.8.1 | yes           | `~/Library/Application Support/sessclone`, writable |
| Linux   | not tested    | —           | —      | —             | no machine available to the operator                |
| Windows | not tested    | —           | —      | —             | no machine available to the operator                |

**The ticket is closed on the macOS row alone, and the other two rows are
untested rather than passing.** The operator has neither a Linux box nor a
Windows box in front of them, and a cloud container is not one: it is the cloud
install, which is finding 69's subject and reports a different Device key and a
different state directory. Nothing here should be read as evidence that the
Collector works on Linux or on Windows.

What each missing row would have to show, when a machine appears:

- **Linux** — `~/.local/state/sessclone` resolved and writable, a `host:` Device
  key rather than a `cloud:` one, and Turns arriving after a restart. Finding 69
  shows the state directory resolving correctly on Linux inside a container, so
  the open question is the install path on a desktop rather than the path
  handling.
- **Windows** — everything above, plus **which Windows it was**. Native Windows
  and WSL resolve different state directories (`%LOCALAPPDATA%\sessclone`
  against `~/.local/state/sessclone`), and `async: true` is what keeps the
  `SessionEnd` hook alive past exit on macOS and Linux — Windows may kill an
  orphaned hook instead, which would make a flush at session end unreliable
  there and nowhere else.

Finding 06 has the Windows config directory and transcript layout observed on a
real Windows box, and the Collector's own state directory confirmed writable by
its operator — but no Collector has ever run there, so Windows remains the
operating system with the least evidence behind it.

### Paste per machine

<!-- One `## macOS`, `## Linux`, `## Windows` section, each holding the block
     the command printed, and a sentence on anything that surprised the
     operator. -->

## macOS

Operator: Taha, 2026-09-22T09:30:26Z, on `host:<laptop-hostname>.local`.

```
Platform     darwin — Darwin 27.0.0
Node         26.8.1 — ok
Device key   host:<laptop-hostname>.local
URL          https://sessclone.vercel.app
Key          starts "sk_", 46 characters
Deployment   answered 200

Install
  ~/.claude/plugins/cache/sessclone
  ~/.claude/plugins/data/sessclone-sessclone
  ~/.claude/plugins/marketplaces/sessclone
  ~/.claude/plugins/sync…/sessclone — 0.0.0

State directory
  ~/Library/Application Support/sessclone — writable: yes
  Cursors: 216 file(s), newest 2026-09-22T09:30:20Z
  Queue:   does not exist

Transcripts
  ~/.claude/projects
  73 session(s), newest 2026-09-22T09:30
  98 agent run transcript(s) across the newest 20, deepest nesting 1
  No session written under more than one project
```

The deployment's own side of the same moment: 5,188 Turns across 23 Sessions,
1,963 of them in the hour of this run, newest received 09:30:54Z; 11
`session_end` markers; 6 archived transcripts; and **zero** rows sharing a
`(member_id, session_id, agent_id, message_id)` identity, which is the property
ADR 0006 exists for and the one a resend would break.

An empty queue directory with 216 cursors is the healthy shape: nothing was
ever refused hard enough to be queued, and each transcript the machine has
carries its own read position.

72 Turns are recorded `complete: false`. That is the interrupted-turn case
ticket 09 defines, not a defect — a turn whose usage was never written before
the session moved on.

## What the documentation failed to warn about

<!-- The last checkbox, and the one worth the exercise. Anything the operator
     had to work out that `docs/install.md` should have said. -->

Three things this exercise found, none of which the documentation warned about,
each fixed before this line was written:

1. **The plugin imported a path no install carries.** Every installed copy
   threw `ERR_MODULE_NOT_FOUND` before sending anything, and the only symptom
   was a Collector that started cleanly and collected nothing (PR #12). The
   install copies `packages/plugin` alone, with no `node_modules`.
2. **`hooks/hooks.json` is loaded by its path alone.** Naming it again under
   the manifest's `hooks` key is refused outright — "Duplicate hooks file
   detected" — and the plugin then registers no hooks (PR #13).
3. **`SessionEnd` hooks share a 1.5-second budget**, not the `timeout` the
   hooks file asks for. Every exit printed
   `SessionEnd hook [...] failed: Hook cancelled` until the hook was marked
   `async: true`, which lets Claude Code spawn it and stop waiting (PR #16).

And one that cost two days of silent failure but belongs to ticket 59 rather
than the install: Supabase Storage refuses an object key containing `%` with
`InvalidKey` after the whole transcript has been uploaded, so percent-encoded
project keys made every archival upload fail while presign answered 200
(PR #15).
