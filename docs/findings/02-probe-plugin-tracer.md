# 02 — Probe plugin tracer: findings

What it took to get one `Stop` hook to put one row in Postgres, verified in
Claude Code 2.1.269 on a cloud environment.

## What had to be true for the hook to fire

1. **The hooks file has to be somewhere Claude Code looks.** Measured one
   variable at a time, installing each layout and reading
   `claude plugin details <name>`:

   | Where `hooks.json` lives | `hooks` key in `plugin.json` | Hooks registered |
   | ------------------------ | ---------------------------- | ---------------- |
   | `hooks/hooks.json`       | absent                       | 1                |
   | `hooks/hooks.json`       | `./hooks/hooks.json`         | 1                |
   | `hooks.json` (root)      | `./hooks.json`               | 1                |
   | `hooks.json` (root)      | absent                       | **0**            |

   So the rule is location **or** pointer, and only the bare root file with no
   pointer fails. The design spec's §5.5 reading — that the pointer is what
   registers hooks — came from a two-variable experiment that moved the file
   and added the pointer in one step. §5.5 is corrected in this commit.

   This repo keeps the pointer anyway: both working layouts cost the same, and
   the pointer is the one that stays correct if the file ever moves.

2. **The marketplace entry needs a relative source.** The repo root carries
   `.claude-plugin/marketplace.json` with `"source": "./packages/plugin"`, so
   `claude plugin marketplace add <path-or-repo>` then `claude plugin install
sessclone@sessclone` works against a clone and against the GitHub repo
   unchanged. `claude plugin validate .` checks both manifests and is worth
   running before a release.
3. **The hook should not fail loudly.** `hooks/stop.mjs` swallows every error
   and always exits 0 — but not for the reason first recorded here. A throwing
   hook does _not_ block the turn: for a `Stop` hook only exit 2 blocks, and an
   uncaught Node exception exits 1, which Claude Code treats as a non-blocking
   error. What exiting non-zero actually costs is a `Stop hook error` notice in
   the transcript on every single turn, which is a poor way to report that a
   deployment is unreachable. The collector's real answer is the on-disk retry
   queue (spec §5.4).
4. **Restart after installing.** Confirmed again here: the hooks of a
   just-installed plugin do not fire in the session that installed them.
   Onboarding ends with "restart Claude Code" for this reason.

## What was measured

One completed turn left exactly one row. Two turns left two rows, one each —
so `Stop` fires once per turn, and the probe needs no dedup to count correctly.
That is not evidence that the real collector can skip dedup: the probe writes
one row per _hook call_, while the collector writes one per _message id_ read
from the transcript, which is where the 2.4x overcount of spec §5.2 lives.

## Surprise worth carrying into ticket 09

**A `session_id` is not unique on its own.** A nested `claude -p` run reported
its parent's `session_id` in the hook payload, and wrote its transcript to
`~/.claude/projects/<other-project-dir>/<same-id>.jsonl`. Two different
conversations, two different files, one id — the distinguishing part was the
project directory, not the id.

Spec §5.3 already records a different way one id lands in two directories: a
session whose working directory changes mid-run. That is not what this was. The
second file's rows carry the child's own prompt and nothing of the parent's
conversation — 54 rows, opening with a `queue-operation` enqueue of the exact
string sent to `claude -p`. Separate conversation, same id.

Unsetting `CLAUDE_CODE_SESSION_ID` did not change it, so this is not simple env
inheritance.

**Refined by finding 03.** That was one variable. With `CLAUDE_CODE_CHILD_SESSION`
unset as well, a nested run mints a fresh random id — so the inheritance is env
driven after all, and `CLAUDE_CODE_SESSION_ID` alone is not the mechanism.

This matters twice for turn identity (ticket 09):

- The sweep of spec §5.3 searches every project directory for a session's id,
  precisely so a session that changed directory is reunited. Against a nested
  run the same behaviour merges two conversations into one Session.
- The dedup key is `(member_id, session_id, agent_id, message_id)`. Message ids
  stay distinct, so this does not overcount Turns — it misgroups them.

The two cases want opposite handling and the filesystem looks the same in both,
so ticket 09 cannot fix this by keying Session identity on the project
directory — that would break the §5.3 sweep it is there to serve. It needs a
signal that separates "same session, moved" from "different session, same id".

Scope of the observation: nested `claude -p` inside a Claude Code session. An
ordinary second terminal was not tested and may well get its own id.

## What is throwaway

- `supabase/migrations/20260912000000_probe_rows.sql` — the `probe_rows` table.
  Ticket 22 replaces it; it carries no RLS policies because nothing reads it.
- `apps/web/app/api/probe/route.ts` — no API key, no org, no turn payload.
- `packages/plugin/hooks/stop.mjs` — sends a session id and nothing else.

The plugin manifest, the marketplace entry, and the CI Postgres service are
not throwaway. They are the mechanics this ticket existed to prove.
