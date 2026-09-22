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

| Environment                | Device key                                   | Turns before the restart arrived | Notes                                 |
| -------------------------- | -------------------------------------------- | -------------------------------- | ------------------------------------- |
| Claude Projects, container | `cloud:6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d` | yes — backfilled by the sweep    | 11 Turns, one Session, 2026-09-22     |
| A second container         |                                              |                                  | needed for the one-Device claim       |
| Killed mid-session         |                                              |                                  |                                       |
| Moved between repositories | same container as above                      | yes                              | two Project keys, one Session (below) |

### Paste per environment

<!-- The block `node scripts/verify-collector.mjs` printed, per container. -->

## First reading: the environment was collecting nothing

Read on a Claude Projects container on 2026-09-22, before any Turn had been
delivered from it:

```
Platform     linux — Linux 6.18.44-fc-v37
Node         22.22.2 — ok
Device key   cloud:6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d
URL          https://supabase.vercel.app
Key          not set

Install
  /root/.claude/plugins/data/sessclone-synced
  /root/.claude/plugins/synced/…/sessclone — 0.0.0

State directory
  /root/.local/state/sessclone — writable: yes
  Cursors: 36 file(s), newest 2026-09-22T08:55:45Z
  Queue:   does not exist
```

Three things that reading settles, before the checklist above is even started:

- **The Device key is the predicted shape.** `cloud:<account uuid>`, with
  nothing the container minted in it — point 3, observed rather than assumed.
- **The state directory resolves to `~/.local/state/sessclone` on Linux** and is
  writable, which is finding 06's prediction for a non-macOS box.
- **The environment was misconfigured, and nothing said so.** `SESSCLONE_URL`
  pointed at `https://supabase.vercel.app`, which answers 404 to
  `POST /api/ingest`, and no `SESSCLONE_API_KEY` was set at all. The deployment
  has one Device row, the Mac; no Turn has ever arrived from a container. The
  plugin was installed and silent, exactly as designed — every refusal is quiet
  — so the only way to see it was to run the check.

That last point is the finding, not the misconfiguration: a Collector with a
wrong URL is indistinguishable from a working one until somebody looks. The
cursors are the tell — 36 of them, none of which could have been written by a
deployment answering 404, so they predate this environment's current settings.

## Second reading: with the environment fixed

The settings were corrected — `SESSCLONE_URL` to the real deployment and a key
set — and a fresh container started, since a variable added to an environment
reaches the next container and not the running one. Its first turn boundary
delivered.

**Turns arrive, and the backfill is real.** 11 Turns in one Session, under
`cloud:6c6ec04b-15a2-4eba-915f-ae53ff0e1e8d`. The earliest Turn _occurred_ at
09:40:11Z and the whole batch was _received_ at 09:41:08Z, when the first `Stop`
hook ran: work done before the Collector was live arrived anyway, read from the
transcript by cursor rather than re-run. That is point 2, and it is the property
that makes an install in a cloud environment forgiving.

**The state directory matches the prediction and the queue stays empty.** One
cursor file, written at the same 09:41:08Z, and no `queue/` directory at all —
nothing had to be retried, so nothing was.

**One Session, two Projects.** Those 11 Turns are recorded under two Project
keys:

| Project key                       | Turns | First Turn   |
| --------------------------------- | ----- | ------------ |
| `local:vm:/home/user`             | 3     | 09:40:11.78Z |
| `github.com/nottahaali/sessclone` | 11    | 09:40:26.04Z |

The container starts outside any repository and the session moves into one, so
the same `session_id` is written under two project directories. This is the
collision finding 74 describes and ticket 09 has to close, **observed live**
rather than reasoned about — and it is ordinary in a cloud container rather than
the edge case it looks like locally. Note what it costs today: a Session's Turns
are split across two Projects in every per-Project total, and under ADR 0003's
naming the same Session would archive under two storage keys.

What is still unproven here is point 3, that every container collapses into one
Device. One Device row is consistent with the claim but does not demonstrate it;
two containers reporting the same `cloud:<account uuid>` would.
