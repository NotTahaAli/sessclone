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

## Container run — three of the four residuals, measured

Docker on this Mac (colima, macOS 27.0, `node:22-alpine`) can kill a container
outright and then destroy its filesystem, which is the part the cloud
environment could not do to itself. It is **not** a Claude Code Cloud reclaim
and nothing here is Claude Code — the writer is a stand-in that appends
200KB JSON lines with one `appendFileSync` each and no `fsync`, the same
syscall shape finding 04 observed (a whole turn written in one step, one
attachment entry of 167,470 bytes among them). What is being tested is the
container runtime and the filesystem, not the model.

Two writers, identical but for one thing: the **busy** one appends in a tight
synchronous `for(;;)` loop, the **paced** one appends from a 50 ms interval and
so returns to the event loop between writes. Both register a SIGTERM handler
that writes a `SessionEnd` line — the stand-in for the hook whose firing this
spike measured above.

| case                        | how it died                   | wall time  | exit | `SessionEnd` written | final byte | torn record         |
| --------------------------- | ----------------------------- | ---------- | ---- | -------------------- | ---------- | ------------------- |
| busy writer, `docker stop`  | SIGTERM ignored, then SIGKILL | **10.56s** | 137  | **no**               | `x`        | **yes**             |
| paced writer, `docker stop` | SIGTERM handled               | 0.11s      | 0    | yes, at +3028 ms     | `\n`       | no                  |
| paced writer, `docker kill` | SIGKILL, no grace             | 0.10s      | 137  | **no**               | `\n`       | no                  |
| `docker rm` after the kill  | filesystem destroyed          | —          | —    | —                    | —          | writable layer gone |

### 1. A torn record is real, and this is what one looks like

The busy writer's file ended **mid-entry**. Its last complete line parses
(`type: assistant`, `n: 20372`, 200,063 bytes). After that newline sit
**78,686 bytes** of entry 20373 — a JSON object cut off inside its `filler`
string, with no terminating newline:

```
{"type":"assistant","n":20373,"msSinceStart":13449,"filler":"xxxx…   ← ends here
```

So an append large enough to need more than one `write()` can be cut in half by
a kill, and finding 04's precaution — _"the collector should still refuse to
parse a tail that does not end in `\n`"_ — is no longer a precaution. It is the
recovery rule, and it is sufficient: everything before the final newline was
intact and parseable in every case. **Truncate to the last `\n`, parse that,
discard the remainder.**

Note which case produced it. The two paced runs both ended on a clean `\n`
despite one of them being SIGKILLed with no warning at all. Tearing needs the
kill to land _inside_ a write, which is likelier the bigger the entry — and
Claude Code writes its biggest entries, whole turns and 167KB attachments, in
one step.

### 2. A grace period is worth nothing to a process that is busy

This is the sharpest result, because both rows are the same `docker stop`
against the same runtime with the same handler registered. The paced writer
heard SIGTERM and was gone in 0.11 s with its `SessionEnd` on disk. The busy
writer never ran its handler, sat through the full **10-second** default grace
window, and was SIGKILLed — exit 137, no `SessionEnd`, and a torn tail.

The signal was delivered both times. Servicing it requires reaching the event
loop, and a process in the middle of writing a turn has not reached it. That is
exactly the moment a reclaim is most likely to hurt, so the honest reading is:
**a graceful-shutdown window is not a mechanism the Collector may depend on.**
It is a bonus that arrives only when nothing is happening, which is when there
was nothing to flush anyway.

It also means "did `SessionEnd` fire?" does not answer "was the container
signalled?". Both `docker kill` and a busy `docker stop` look identical from
the log: nothing.

### 3. Destroying the container destroys the transcript; a volume survives

Each writer wrote the same lines twice — once to a named volume, once to the
container's own writable layer.

- While the killed container still existed, the writable-layer copy was fully
  recoverable: `docker cp` pulled back all 11,603,450 bytes from a dead
  container.
- After `docker rm`, that path was gone — `No such container` — while the
  volume copy was byte-identical at 11,603,450 bytes.

So residual 1 splits in two. A _stopped_ environment is still a recovery
source; a _removed_ one is not, and nothing on its filesystem is a recovery
source at any price. For a self-hosted Collector in Docker — which ticket 67
ships a compose file for — the state directory must be a named volume or a bind
mount. On the default writable layer, a `docker rm` silently discards the
cursor and every queued report, and that is a configuration mistake nothing
will report.

### What this still does not answer

- ~~Page-cache loss (residual 2)~~ — **measured; see the next section.**
- **Claude Code Cloud's own policy (residual 3) is still unknown.** Docker's
  10-second SIGTERM-then-SIGKILL is Docker's, and says nothing about what the
  platform does. The finding that transfers is the shape, not the number: if a
  reclaim signals at all, only an idle session benefits.
- **Multi-turn sessions (residual 4)** — the substantive half is now measured
  with real Claude Code; see below. A genuinely _interactive_ TTY session is
  still unexercised.

## Multi-turn loss profile — residual 4, measured

Every earlier run was single-turn, so "only the in-flight turn is lost" was an
assumption the Collector's whole recovery story rests on. Measured here with
real Claude Code 2.1.267 on macOS: one session, `--model haiku`, cwd
`/tmp/spike-05-multiturn`, two turns completed and a third SIGKILLed ~2 s in.

| stage                       | bytes   | rows | usage-bearing rows | distinct `message.id` |
| --------------------------- | ------- | ---- | ------------------ | --------------------- |
| after two completed turns   | 240,397 | 46   | 4                  | 2                     |
| after SIGKILL during turn 3 | 240,743 | 48   | 4                  | 2                     |

**The completed turns survive untouched, and the in-flight turn contributes
nothing.** The kill added 346 bytes and two rows, and both are bookkeeping —
`last-prompt`, `mode`, and two `queue-operation` entries. No `assistant` entry,
no `usage`, not even a partial one. The prompt landed; the turn did not, which
is the same shape `fixtures/transcripts/killed-mid-turn.jsonl` holds for a
single-turn session.

The file also ended on a clean newline with every line parseable. That is the
expected pairing with the torn-record result above: tearing needs the kill to
land inside a large write, and a turn that never produced its response never
started one.

So the design's assumption holds. A session that has been running for an hour
loses one turn to a kill, not its history — and the loss is total for that turn
rather than partial, so there is no half-priced Turn to detect or discard.

**Still not exercised: a real interactive TTY session.** This was
`claude -p --resume`, which is multi-turn but headless. An interactive session
holds more state in memory and may flush on a different schedule; nothing here
rules out a difference, it only removes the multi-turn question from the list.

## Page-cache loss — residual 2, measured

The container run could not threaten the page cache, because the host kernel
kept running. Hard-killing the VM would have answered it and taken the
operator's unrelated containers with it, so the question was asked a contained
way instead: an ext4 filesystem on a **loop device** inside the colima VM, with
the _backing file_ read directly afterwards. The backing file holds only what
actually left the filesystem's page cache for the block device, so the gap
between "bytes `write()` returned for" and "bytes in the backing file" is
exactly what a sudden storage loss would take.

100 entries of 200,000 bytes, one `append`-mode `write()` each, no `fsync` —
the shape Claude Code uses when it writes a finished turn in one step.

| moment                                               | entries on the device  |
| ---------------------------------------------------- | ---------------------- |
| immediately after 20,005,800 bytes were acknowledged | **0 / 100**            |
| ~5 s idle, no sync                                   | **0 / 100**            |
| ~10 s idle, no sync                                  | 100 / 100              |
| after an explicit `sync`                             | 100 / 100              |
| **contrast:** `fsync` per entry                      | 100 / 100, immediately |

### Everything acknowledged can be nothing on disk

All twenty megabytes returned from `write()` in under 10 ms, and **not one byte
of it was on the device**. A reclaim landing in that instant loses the whole
file while every write has already succeeded. This is not a partial loss or a
torn tail — it is total, and the application has no way to know.

The window closed between the 5-second and 10-second checks with no `sync` from
anyone, which is ext4's journal commit doing its ordinary work
(`dirty_writeback_centisecs` is 500 on this kernel, `dirty_expire_centisecs`
3000). So the exposure is roughly **the last five seconds of writing**, and the
cost of removing it is in the last row: `fsync` per entry put everything on the
device immediately, for 0.13 s against ~0.00 s.

### What this settles for the Collector

**The transcript on disk is not a recovery source for a recent turn.** Ticket
39's sweep re-reads transcripts to recover what a dying environment never
reported; this says the sweep can only recover what is at least a few seconds
old. A reclaim landing on a just-finished turn leaves nothing to sweep — not a
truncated record, not a torn line, nothing.

That is an argument the design already made for other reasons, now with a
measurement behind it: **the bytes the Collector has pushed over the network
are safer than the bytes on the member's disk.** Pushing on `Stop` rather than
batching and trusting a later sweep is the difference between a turn surviving
and a turn never having existed. The same goes for the cursor and the retry
queue — a queue file that exists only in page cache is a queue a reclaim
silently empties. If any file in this product is worth an `fsync`, it is the
queue, and this is the number that justifies paying for it.

It also explains why the earlier container runs looked so clean. Their files
were read back through the same page cache that held the unflushed data, so
every byte appeared present. A reader on the dying kernel cannot see this loss
at all; only the storage can.

### Scope

ext4 with default `data=ordered` on a loop device in a Linux VM, not Claude
Code Cloud's storage. The five-second figure is this kernel's writeback timing
and nothing else. What transfers is the shape: acknowledged is not durable, the
gap is total rather than partial, and it closes on a timer nobody in the
application controls.

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
