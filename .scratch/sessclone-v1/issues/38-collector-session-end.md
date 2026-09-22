# 38: Collector — session end

**What to build:** A Session's final Turns are flushed when it ends, and the Session is marked complete so later sweeps know not to re-read it.

**Blocked by:** 05, 33, 37.

**Status:** done

- [x] Final flush on session end, covering Turns after the last routine report
- [x] Completeness recorded, and the ticket states plainly whether that record is local or server-side and what the choice costs when a container dies
- [x] Behaviour under a killed container matches what the spike found, or the gap is documented

## What landed

A `SessionEnd` hook (`packages/plugin/hooks/session-end.mjs`) doing two jobs in
one request: a final flush from the cursor, and a `session_end` completeness
marker on the payload (`ReportedSessionEnd`) that ingest writes to
`session_events`. The flush loop that `Stop` ran is now `flush()` in
`report.mjs`, called by both hooks; the marker rides the flush's first request
when there is one, so it costs no extra round trip, and is a request of its own
when there is nothing to flush.

**The completeness record is server-side, not local, and deliberately so.** A
local marker beside the cursor would be written on the machine that ran the
session and lost with it — which is the exact case a sweep exists for. Finding
05 measured that a container reclaimed by `SIGKILL` fires no `SessionEnd` at
all (and `SIGTERM` fires it ~180 ms later, flushing nothing extra, because the
in-flight turn was never written to disk). So the record _never being written_
is itself the signal of an abnormal end, and that signal has to outlive the
container to be read. The cost: one small row per clean session end; and, when
a container dies, a Session that is never marked complete and so is re-read by
the sweep until its cursor goes stale — bandwidth, never a lost Turn.

**Behaviour under a killed container matches the spike** (`docs/findings/05-*`):
this hook does not run under `SIGKILL` and has nothing extra to flush under
`SIGTERM`, and the design leans on exactly that — the absence of the marker is
the recoverable record, read server-side. The sweep that consumes it is ticket
39's; ticket 38 writes the record it will read.
