# 69 — Manual verification: cloud install

Claude Code Cloud and Claude Projects, where there is no persistent shell, the
container is replaced under you, and the hooks do not fire in the session that
installs them.

Configuration is per environment, from claude.ai, before a session starts: the
two `claude plugin` commands in the environment's **init script**, and
`SESSCLONE_API_KEY` and `SESSCLONE_URL` in the environment's **settings**. A
variable exported inside a session dies with the container that set it.

## What to observe

1. **The install session reports nothing.** Expected, not broken: hooks take
   effect on the next start.
2. **The first sweep after the restart backfills it.** The Turns written before
   the restart arrive without anything being re-run, because the session-start
   hook re-reads every recent transcript from its cursor.
3. **Every container collapses into one Device.** `verify-collector.mjs` prints
   the Device key; run it in several containers and compare the strings. They
   should all read `cloud:<account uuid>` — the account outlives the container,
   and nothing the container mints is in the key.
4. **A container killed mid-session.** Finding 05 predicts `SessionEnd` fires
   about 180 ms after `SIGTERM` and not at all under `SIGKILL`, and flushes
   nothing. Usage is still counted, because Turns come from the transcript; what
   can be lost is the session **event**.
5. **Claude Projects as well as Claude Code Cloud**, including a Session whose
   subagent transcripts sit one directory deeper, and a Session that moved
   between repositories mid-flight (finding 74). The script reports the deepest
   subagent nesting it found and names any Session written under more than one
   project directory.

## Results

| Environment                    | Device key | Turns before the restart arrived | Notes |
| ------------------------------ | ---------- | -------------------------------- | ----- |
| Claude Code Cloud, container 1 |            |                                  |       |
| Claude Code Cloud, container 2 |            |                                  |       |
| Claude Projects                |            |                                  |       |
| Killed mid-session             |            |                                  |       |
| Moved between repositories     |            |                                  |       |

### Paste per environment

<!-- The block `node scripts/verify-collector.mjs` printed, per container. -->
