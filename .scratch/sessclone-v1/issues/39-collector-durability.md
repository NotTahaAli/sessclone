# 39: Collector — retry, queue, and sweep

**What to build:** Nothing is lost to a dropped connection: reports retry, then queue, and the next Session in that environment sweeps up whatever is outstanding.

**Blocked by:** 05, 06, 36, 37, 38.

**Status:** done

- [x] Three retries at increasing delays before the queue is touched
- [x] A queued report drained by the next session start in that environment
- [x] The sweep re-reports every Session not known to be complete, in full
- [x] The sweep backfills Turns from before a plugin install took effect
- [x] Behaviour proven with faked time and transport, so no test waits on a real delay
- [x] The residual gap is documented where a user will see it, not only in the spec

## Note from ticket 40/38 (durability of session events)

A `stop_failure` and a `session_end` differ from a Turn in one way that this
ticket must handle: **they have no cursor fallback.** A Turn dropped by a failed
request is re-read from the transcript by the next `Stop` or by this sweep,
because the cursor never advanced. A stop failure reads no transcript and moves
no cursor, so if its one `send()` is dropped while the deployment is down, there
is nothing that re-reads it — the queue is its only durability. Same for a
`session_end` marker when it rides a request of its own.

Two requirements follow:

- The queue must hold whole payloads (failures and the session-end marker
  included), not just transcript positions.
- A queued failure or marker must be re-sent **byte-identical**, `occurredAt`
  unchanged. That timestamp is part of `session_events_identity_key`, so a
  re-send with a fresh clock is a second row, not a dedup — the idempotence the
  route provides depends on the Collector replaying the same value.

## What landed

- `packages/plugin/src/queue.mjs` — atomic temp+rename `enqueue`, oldest-first
  `drainQueue` (stops on unreachable/5xx, drops 4xx and corrupt), 500-entry cap
  and 14-day TTL enforced on write.
- `packages/plugin/src/report.mjs` — `deliver()` (three backoff retries, then
  `enqueue`; a 4xx is final and never queued), and `sweep()` (drain the queue,
  then re-flush every session from `allSessions()` newest-first, time-boxed to
  `SWEEP_BUDGET_MS`). The `session_end`/`stop_failure` markers go through
  `deliver`; Turns keep plain `send`, since their cursor recovers them.
- `packages/plugin/src/transcripts.mjs` — `allSessions()` enumerates every
  main transcript, newest first, deduped across project directories.
- `hooks/session-start.mjs` — runs the sweep once the configuration is good,
  silent and exit 0, lazy-importing `report.mjs`.
- Residual gap (a queued session **event** never drained) documented in
  `docs/configuration.md`, where a self-hoster reads it.
- Tests: `queue.test.mjs`, `sweep.test.mjs` — faked transport, injected sleep,
  faked clock; the durability guarantees red-verified by reverting each.
