# 05 — Killed process: findings

What a `SIGTERM` and a `SIGKILL` actually cost, measured on Claude Code 2.1.269
in a cloud environment, with `SessionStart`/`Stop`/`SessionEnd` hooks appending
to a log file outside the dying process's control.

**This is not the ticket.** Ticket 05 asks about a forcibly reclaimed
_container_. This environment cannot reclaim itself, so what was exercised is a
nested `claude -p` run killed at the process-group level. Everything below the
"What was not exercised" heading is still open, and ticket 05 stays open with
it.

## What was measured

Seven nested runs, `--model haiku`, one-sentence prompt ("Count from 1 to 400,
one number per line, nothing else."), cwd `/tmp/spike-05`, hooks installed via
`--settings`. One variable at a time: clean exit, `SIGTERM -<pgid>`,
`SIGKILL -<pgid>`, and for the signals, two kill points — before the assistant
turn was flushed, and after. Transcripts are kept unredacted in the session
scratchpad at `spike-transcripts/05/` with a `CASES.md` index.

| case                 | death  | hooks that fired                             | transcript bytes | rows | assistant rows |
| -------------------- | ------ | -------------------------------------------- | ---------------- | ---- | -------------- |
| clean                | exit 0 | `SessionStart`, `Stop`, `SessionEnd`         | 439024           | 29   | 2              |
| SIGKILL, after flush | ~9.1 s | `SessionStart` **only**                      | 438533           | 27   | 2              |
| SIGKILL, mid-turn    | ~1.6 s | `SessionStart` **only**                      | 260859           | 22   | **0**          |
| SIGTERM, mid-turn    | ~1.5 s | `SessionStart`, `SessionEnd` — **no `Stop`** | 260859           | 22   | **0**          |

The SIGTERM result was reproduced twice, byte-identical.

## Decisive evidence

1. **`SIGTERM` fires `SessionEnd`. `SIGKILL` fires nothing.** Under SIGTERM the
   hook log gained a `SessionEnd` line ~1.1 s after `SessionStart`; under
   SIGKILL the log gained nothing after `SessionStart`, at either kill point.
   The process has a shutdown path, and `SIGKILL` is precisely the signal that
   denies it.

2. **`Stop` never fires for an interrupted turn.** Even under SIGTERM, where
   `SessionEnd` did fire, `Stop` did not — consistent with `Stop` meaning "a
   turn completed", not "the process is going away". A collector that counts
   turns from `Stop` silently under-counts every interrupted session; it does
   not error, it just never hears about the turn.

3. **`SessionEnd`'s `reason` does not distinguish a kill from a clean exit.**
   Both the clean run and the SIGTERM run reported `"reason":"other"`. There is
   no field in the payload that says "this session was terminated". The
   collector cannot branch on it.

4. **`SessionEnd` flushes nothing extra.** The SIGTERM transcript is 260859
   bytes — byte-for-byte the size it had _before_ the signal, and identical to
   the SIGKILL-mid-turn transcript. Firing `SessionEnd` buys a notification, not
   data. Whatever the turn had produced in memory is gone in both cases.

5. **The in-flight turn is written in one step at the end, not streamed to
   disk.** Polling the jsonl every 50 ms through a clean run: the file sits at
   exactly 260859 bytes with **zero** assistant rows from 1.73 s to 7.25 s —
   the entire ~5.5 s of generation — then both assistant rows appear together
   and the file jumps to 438421. There is no partial assistant row on disk at
   any point.

   This is the byte-level answer the recovery sweep needs, and it is a
   simplification, not a complication: **the loss is whole rows, never half a
   row.** A turn killed before its flush leaves no trace of itself in the
   transcript at all — not a truncated one.

6. **No torn records.** Every killed transcript ends on a newline and every
   line parses as JSON, including the SIGKILL cases. The sweep does not need a
   torn-last-line recovery path for this failure mode.

7. **A kill after the flush still loses the tail of the session.** The
   SIGKILL-after-flush transcript has both assistant rows but is 2 rows short of
   the clean run: the `system` row and the closing `last-prompt` row are
   missing, and `claude -p` wrote 0 bytes to stdout. The assistant content
   survived; the session's own record of having finished did not.

## What the sweep must recover, based on observed behaviour

- **A session with no `assistant` row after its last `last-prompt` row is
  an interrupted turn.** That shape is the signature, and it is unambiguous
  here: it never occurs in a clean run, because the assistant rows land before
  the closing rows do.

  Stated carelessly the first time as "the last row is `last-prompt`", which the
  committed fixture disproves: `killed-mid-turn.jsonl` ends `last-prompt`,
  `atis-latch`. Bookkeeping rows keep arriving after the prompt, so a sweep
  testing the final row alone classifies nothing.

- **The interrupted turn's content is unrecoverable from the transcript.** It
  was never on disk. The sweep can report _that a turn was lost_ and its prompt,
  never what the model said. Anything in the design that assumes a partial
  assistant payload can be salvaged from a killed session is wrong.
- **Do not treat `SessionEnd` as the end-of-session signal.** It is absent under
  SIGKILL entirely, and when present it carries `reason: "other"` exactly as a
  clean exit does. Session completion has to be inferred from the transcript's
  own shape (closing `system` + `last-prompt` rows present) or from the
  collector's cursor going stale, not from a hook that may never arrive.
- **`Stop`-driven ingestion needs a liveness backstop.** Since neither `Stop`
  nor `SessionEnd` is guaranteed, the last thing the collector hears from a
  killed session is whatever it pushed before the kill. A sweep that only runs
  on `SessionEnd` will never run for the sessions that most need it.
- **The retry queue must survive the process.** Anything queued in memory at
  kill time is lost with it; the on-disk queue of spec §5.4 is what the SIGKILL
  case actually validates.

## What was not exercised — the residual

None of this is a container reclaim. What was killed is one nested `claude`
process group on a filesystem that stayed mounted, on a machine that kept
running, with the hook log and the transcript both readable a second later.
A reclaim differs in at least four ways that this spike could not touch:

1. **The filesystem goes away with the process.** Here the transcript was
   re-read after death. In a reclaim the transcript may be on a volume that is
   detached or destroyed, in which case "what is on disk" is not a recovery
   source at all and the only surviving record is whatever the collector already
   pushed. Untested.
2. **Unflushed OS page cache.** All sizes here were read with `stat` on a live
   kernel, so a write that reached the page cache but not the disk still counted
   as present. A reclaim that pulls the storage can lose bytes that this
   experiment counted as written. Untested — and it is the one way a torn record
   could still appear.
3. **Whether the platform sends a signal at all before reclaiming, and how long
   the grace period is.** The SIGTERM/SIGKILL split is the whole story of
   whether `SessionEnd` fires. If a reclaim sends SIGTERM with a grace window,
   `SessionEnd` fires and the finding above applies as written; if it kills the
   cgroup outright, nothing fires. Which one happens is a property of the
   platform, and was not observable from inside.
4. **An interactive session rather than `claude -p`.** Every run here was
   headless and single-turn. A long-lived interactive session with many turns
   already flushed has a different loss profile — only the last turn is at risk
   — and that shape was not measured.

### What a future run on a reclaimable environment must check

- Install the same three-hook settings file, start a session, force a reclaim
  from **outside** the environment, and read the hook log from a destination
  that outlives it (an HTTP endpoint, not a local file — a local log is exactly
  what a reclaim takes with it).
- Record whether `SessionEnd` fired, and if so, its `reason` — specifically
  whether a reclaim produces a `reason` other than `"other"`. If it does, the
  collector gets the branch it currently cannot have.
- Measure the grace period: how long between the first signal and the process
  actually dying. That number is the entire budget for any flush-on-shutdown the
  collector might attempt.
- Confirm whether the transcript is readable after the reclaim at all, from a
  restarted environment on the same volume. That single yes/no decides whether a
  recovery sweep is a real mechanism or a fiction.
- Re-run with an interactive multi-turn session, to confirm that only the
  in-flight turn is lost and previously flushed turns survive.
