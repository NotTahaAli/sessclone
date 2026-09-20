# 05: Spike — killed container

**What to build:** An answer: does a forcibly reclaimed environment fire `SessionEnd` at all, and what is left unreported when it does not.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A container killed rather than exited cleanly, and the hook firings observed
- [x] Findings note states what the sweep must recover and what is unrecoverable
- [x] The documented residual gap is either confirmed or narrowed

**Still open, and much narrower.** Two of the four residuals are now closed by
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

What is still open:

- **Real Claude Code hooks under a container kill** — the first criterion. The
  container run used a stand-in, and the hook firings measured earlier were a
  process kill, not a container one. Needs Claude Code authenticated inside a
  container, which is a credential step for the operator rather than something
  to automate. The harness is written and ready at
  `docs/findings/05-harness/`.
- **Claude Code Cloud's own reclaim policy.** Whether the platform signals at
  all, with what grace, and whether `SessionEnd`'s `reason` finally
  distinguishes a reclaim. Docker's 10-second SIGTERM-then-SIGKILL is Docker's
  and says nothing about it. Same harness applies.
- **A real interactive TTY session.** The multi-turn run was
  `claude -p --resume` — multi-turn but headless. An interactive session may
  hold more in memory and flush differently.
