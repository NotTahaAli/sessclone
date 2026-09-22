# 59: Collector — archival opt-in and upload

**What to build:** A Member who opts in gets their transcripts archived off the machine, with nothing leaving it until they do.

**Blocked by:** 14, 33, 58, 72.

**Status:** done

- [x] Off by default; nothing uploads until the Member turns it on
- [x] Transcript uploaded directly to storage, never through the application
- [x] An unchanged transcript is not re-uploaded
- [x] A Session's object is replaced as it grows rather than accumulating versions
- [x] A refused presign is handled quietly and retried on the next opportunity

## What landed

- `packages/plugin/src/archive.mjs` — hash the transcript, ask
  `/api/logs/presign`, `PUT` to the URL it issues, then confirm it. The file is opened for upload only after the presign
  says yes, so the opt-in, the per-Project exclusion and the Tier gate all
  keep the bytes on the machine with no switch held locally. The upload is
  streamed (a transcript is source code and can be tens of megabytes) and
  time-boxed, and every refusal is quiet: there is no queue, because the
  transcript is still on disk and the next `SessionEnd` or sweep asks again.
- Wired into `hooks/session-end.mjs` (the Session's transcripts are final
  there) and into `sweep()` after each session's Turns, sharing the sweep's
  time box so Turns are never crowded out by one large upload.
- `POST /api/logs/confirm` (`apps/web/app/api/logs/confirm/route.ts`) — what
  writes `log_artifacts`. Ticket 58's presign route deliberately writes no
  row: the PUT between the two requests is the part that fails, and a row
  written before the bytes landed would claim a transcript is stored while the
  hash guard refused to ever upload it again. The route re-derives the object
  key and the Project server-side, reads the object's size back from storage
  (`storedObject`, added to `lib/storage.ts`) rather than believing the
  Collector, and upserts on the Session's identity so a growing Session
  replaces its row and its object instead of accumulating versions.
  Confirming the same bytes twice is a success, not a refusal, which is what
  makes a lost answer safe to retry.
- Tests: `packages/plugin/src/archive.test.mjs` (order of the three requests,
  the key in the header and never in a body or to storage, every refusal
  uploading nothing, a failed upload never confirmed) and
  `apps/web/test/confirm.test.ts` against real Postgres (the row and its
  sizing, the derived key, replacement rather than accumulation, Agent Runs as
  their own rows, idempotent re-confirm, no row without an object, every
  presign refusal, one 401 for every way a key fails, and somebody else's
  Session). The two claims worth breaking were verified red: trusting a
  client-supplied size, and writing the row with no object in the bucket.

The SHA-256 stays the Collector's word: computing it server-side would mean
downloading the transcript through the application, which is the one thing ADR
0003 exists to prevent. A Member who lies about it can only cause their own
next upload to be skipped as unchanged.

## Acted on after review

- **The confirm records the key the bytes actually went to.** A Turn under
  another Project can land between the presign and the confirm (ADR 0003's
  mid-run Project change), which moves the derived key — and a row written
  then would name one object while carrying another's hash and size, with the
  unchanged guard keeping it forever. The request now echoes the key it PUT
  to, the route compares it against its own derivation and answers
  `stale_key`, and the Collector presigns again.
- **A replaced row destroys the object it left behind.** A Session that moved
  Project used to leave its old transcript in the bucket with no row naming
  it: bytes no retention sweep can reach, which for a transcript means source
  code and sometimes credentials kept forever. The upsert returns the previous
  key and the object is deleted after the row is written.
- **The upload is bounded to the size that was hashed.** `stat` once, hash
  that range, upload that range. A transcript being appended to by a live
  session used to fail its `PUT` after sending the whole file, on every pass
  forever, because the stream yielded more bytes than `content-length`
  declared.
- **An Agent Run keeps its own id.** A file under `subagents/` whose name
  carries no id was filed under the _Session's_ key and replaced the Session's
  own transcript; it is skipped now.
- **`SessionEnd` archives inside a budget** (8s of the hook's 10), so a
  Session with several Agent Runs is not killed mid-request.
- **A settled answer is not paid for twice.** The outcome is remembered under
  `<state dir>/archived/` keyed on the file's size and mtime, so an unchanged
  transcript costs neither a re-hash nor a request while the answer cannot
  change. The transient outcomes are deliberately not remembered.
- **The `unchanged` branch cannot throw.** Its read is inside the route's
  error handling, and a row the Member destroyed between the two statements is
  the transient `not_uploaded` rather than an assertion.

Known ceiling, stated rather than fixed: archival shares the sweep's time box
with the Turns and `allSessions` is newest-first, so on a machine with a long
history the older sessions are archived over several starts. A session that
ends cleanly is archived by `SessionEnd` in its own budget, so this only
affects catching up on history.
