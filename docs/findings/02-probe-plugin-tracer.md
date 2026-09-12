# 02 — Probe plugin tracer: findings

What it took to get one `Stop` hook to put one row in Postgres, verified in
Claude Code 2.1.269 on a cloud environment.

## What had to be true for the hook to fire

1. **The manifest needs a `hooks` pointer.** `packages/plugin/.claude-plugin/plugin.json`
   carries `"hooks": "./hooks/hooks.json"`. A `hooks/hooks.json` sitting in the
   plugin with no pointer is discovered in some layouts and ignored in others;
   the pointer is the form that is always read. `claude plugin details
sessclone` is how you tell — it printed `Hooks (1)  Stop` once the pointer
   was there, and would print `Hooks (0)` without it.
2. **The marketplace entry needs a relative source.** The repo root carries
   `.claude-plugin/marketplace.json` with `"source": "./packages/plugin"`, so
   `claude plugin marketplace add <path-or-repo>` then `claude plugin install
sessclone@sessclone` works against a clone and against the GitHub repo
   unchanged. `claude plugin validate .` checks both manifests and is worth
   running before a release.
3. **The hook must not fail loudly.** A hook that throws blocks the session it
   fires in, so `hooks/stop.mjs` swallows every error and always exits 0. The
   cost of that choice is that a broken deployment is silent — the collector's
   real answer is the on-disk retry queue (spec §5.4), not a louder hook.
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

Unsetting `CLAUDE_CODE_SESSION_ID` did not change it, so this is not simple env
inheritance.

This matters twice for turn identity (ticket 09):

- The sweep of spec §5.3 searches every project directory for a session's id.
  Against a nested run it would merge two conversations into one Session.
- The dedup key is `(member_id, session_id, agent_id, message_id)`. Message ids
  stay distinct, so this does not overcount Turns — it misgroups them.

Scope of the observation: nested `claude -p` inside a Claude Code session. An
ordinary second terminal was not tested and may well get its own id. Ticket 09
should settle whether Session identity needs the project directory (or the
transcript path) alongside the id.

## What is throwaway

- `supabase/migrations/20260912000000_probe_rows.sql` — the `probe_rows` table.
  Ticket 22 replaces it; it carries no RLS policies because nothing reads it.
- `apps/web/app/api/probe/route.ts` — no API key, no org, no turn payload.
- `packages/plugin/hooks/stop.mjs` — sends a session id and nothing else.

The plugin manifest, the marketplace entry, and the CI Postgres service are
not throwaway. They are the mechanics this ticket existed to prove.
