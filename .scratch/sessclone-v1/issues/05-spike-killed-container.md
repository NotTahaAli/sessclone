# 05: Spike — killed container

**What to build:** An answer: does a forcibly reclaimed environment fire `SessionEnd` at all, and what is left unreported when it does not.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A container killed rather than exited cleanly, and the hook firings observed
- [x] Findings note states what the sweep must recover and what is unrecoverable
- [x] The documented residual gap is either confirmed or narrowed

**Done.** Two of the four residuals were closed by
a container run on Docker (colima, macOS), recorded in
`docs/findings/05-killed-process.md`. It is a stand-in, not Claude Code — the
writer appends 200KB JSON lines with one `appendFileSync` each, the syscall
shape finding 04 observed — so it answers questions about the runtime and the
filesystem, not about Claude Code's hooks. That is why the first criterion
stays unticked.

What it settled:

- **A torn record is real and has a known shape.** A `SIGKILL` landing inside a
  200,063-byte append left 78,686 bytes of a half-written entry after the last
  newline. Everything before that newline parsed. So finding 04's precaution is
  now the recovery rule, and it is sufficient: truncate to the last `\n`, parse
  that, discard the rest.
- **A grace period is worth nothing to a busy process.** Same `docker stop`,
  same handler, two writers: the paced one exited cleanly in 0.11 s with its
  shutdown line on disk; the one in a tight write loop never reached its
  handler, sat through the full 10-second window, and was SIGKILLed — exit 137,
  no shutdown line, torn tail. Claude Code writes a whole turn in one step, so
  that is precisely the moment a reclaim would land. The Collector must not
  depend on a flush-on-shutdown.
- **Destroying the container destroys the transcript.** A stopped container's
  writable layer was still fully recoverable by `docker cp`; after `docker rm`
  it was gone, while the named-volume copy was byte-identical. For ticket 67's
  compose file this is a hard requirement: the Collector's state directory must
  be a volume or a bind mount, never the writable layer.

Two more residuals closed since, both on this machine:

- **Page-cache loss.** ext4 on a loop device inside the colima VM, with the
  backing file read directly — the boundary a storage loss actually cuts.
  20,005,800 bytes were acknowledged by `write()` in under 10 ms and **0 of 100
  entries were on the device**. Still 0 after 5 s; all 100 by 10 s, with no
  `sync` from anyone. So roughly the last five seconds of writing is exposed,
  and the loss is _total_, not partial — a reader on the dying kernel cannot
  even see it, because it reads through the same page cache. `fsync` per entry
  closed the gap for 0.13 s against ~0.00 s.

  This is why the transcript on disk cannot be ticket 39's recovery source for
  a recent turn, and why the queue file is the one thing in this product worth
  paying an `fsync` for.

- **Multi-turn loss profile.** Real Claude Code 2.1.267, two completed turns
  then a SIGKILL 2 s into a third. The completed turns were untouched — 4
  usage-bearing rows and 2 `message.id`s before and after — and the kill added
  only 346 bytes of bookkeeping (`last-prompt`, `mode`, two `queue-operation`),
  no `assistant` entry and no partial usage. The file ended on a clean newline.
  The design's assumption holds: a long session loses one turn, not its
  history, and loses it completely rather than half-priced.

**The first criterion is now met.** Real Claude Code 2.1.278, signed in with a
`setup-token` OAuth token, inside Docker, hooks POSTing to a sink container on
the same network, SIGKILLed 3 s into a turn. Exit 137, **`SessionStart` only** —
no `Stop`, no `SessionEnd` — against a clean-exit baseline that fired all three.
The transcript held 0 usage-bearing entries against the baseline's 3, every line
parsed, and the file ended on a newline. `docker cp` recovered all 52,877 bytes
from the dead container, so a killed environment is still a recovery source and
only `docker rm` destroys it. Every process-level finding survived the move to a
container unchanged.

A `docker stop` arm was run too, and it corrected a prediction. Claude Code
**does** service SIGTERM — exit 143, `SessionEnd` 180 ms after the signal,
process gone in 0.72 s of a 10 s window. The stand-in had sat out the whole
window only because it blocked in a synchronous write loop. But the graceful
shutdown bought **301 bytes and one line over the SIGKILL run, and zero extra
usage-bearing entries**: a turn is written in one step when it completes, so at
signal time there is no partial turn to flush and `SessionEnd` has nothing to
save. `reason` was `"other"` there too.

That is a useful negative for the Collector. A platform that signals before
reclaiming needs no special handling, because the turn a flush would rescue
does not exist in any form yet.

**The ticket's question is answered.** Does a forcibly reclaimed environment
fire `SessionEnd`? Under SIGTERM yes, within 180 ms; under SIGKILL never. What
is left unreported when it does not fire: the whole in-flight turn — and the
measurement that matters is that the same turn is left unreported when it
_does_ fire. A turn is written in one step on completion, so at signal time
there is no partial turn to flush and no shutdown path can save it.

Two things stay unmeasured. Neither is in the acceptance criteria, both are
recorded in `docs/findings/05-killed-process.md`, and the harness for them is
committed at `docs/findings/05-harness/`:

- **Whether a Claude Code Cloud reclaim leaves the transcript readable.** The
  signalling half no longer matters — both signals are measured and the
  in-flight turn is worth zero under each — so the only open question is
  whether a reclaim takes the storage with it. The `docker rm` result suggests
  it does.
- **A real interactive TTY session.** The multi-turn run was
  `claude -p --resume`: multi-turn but headless.
