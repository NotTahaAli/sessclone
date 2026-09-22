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
