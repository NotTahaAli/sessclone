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

What is still open:

- **Page-cache loss.** Every file was read back on a kernel that kept running.
  Proving an abrupt _host_ death loses acknowledged writes needs the VM itself
  hard-killed, which would have taken the operator's unrelated containers with
  it. Not done.
- **Claude Code Cloud's own reclaim policy.** Docker's 10-second
  SIGTERM-then-SIGKILL is Docker's. Whether the platform signals at all, and
  with what grace, is still unobservable from inside.
- **Interactive multi-turn sessions.** No stand-in can settle these; it needs
  real Claude Code in an environment someone can reclaim.
