# 40: Collector — stop failures

**What to build:** When a session dies on a rate limit or an overload, that fact is recorded — the question a subscription user actually has. Extends the route test suite.

**Blocked by:** 33.

**Status:** done

- [x] Failure type and message recorded against the Session
- [x] Route accepts the event through the same key verification as Turns
- [x] Table ships with its policies, and they are covered by the policy suite

## What landed

A `StopFailure` hook (`packages/plugin/hooks/stop-failure.mjs`), the `failures`
array on the ingest payload, and the insert into `session_events` that the
collection migration already made room for.

The error type is stored as free text in the row's `detail`, not as a `kind`:
`kind` is a closed set the table checks, and Claude Code names eleven error
types today and may name a twelfth. A type this version has never heard of is
the case most worth recording, and refusing the payload over it would also
throw away any Turns riding in the same request.

The hook reads no transcript and moves no cursor. `Stop` does not fire on a
failed turn, so the Turns before the failure are reported by the next `Stop` or
the `SessionStart` sweep — from a cursor this path has no reason to touch.

`occurred_at` is the Collector's own clock, because the event carries no time.
That makes it stable across a retry of the same payload, which matters:
`session_events_identity_key` includes it, so a re-sent failure is the same row
rather than a second one.

The table's policies shipped with it in `20260920120100_collection.sql`
(`session_events_read`, visible exactly as far as the Turns beside it) and are
covered in `apps/web/test/rls.test.ts`. No policy change was needed here; the
route writes as the service connection, as it does for Turns.

Nothing reads these rows yet — `docs/design/product-ia.md` says so under "What
has no home yet", and that is still true.
