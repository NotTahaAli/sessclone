// Ticket 38: the session ended.
//
// Two jobs, one request. A final flush of whatever the cursor is still behind
// on — a `Stop` report that failed has no next `Stop` to retry it, and a
// session can end on something other than a turn (`/clear`, a fork) — and a
// `session_end` completeness marker so a later sweep knows this Session is done
// and need not be re-read. The marker rides the flush's first request when
// there is one, so it costs no extra round trip.
//
// What this hook cannot do is what finding 05 measured: `SessionEnd` fires
// ~180 ms after a `SIGTERM` and never under a `SIGKILL`, and the interrupted
// turn was never written to disk — so there is nothing extra to flush for the
// turn that was in flight when the signal arrived, and under a hard kill this
// hook does not run at all. That is why the completeness record is server-side
// (`ReportedSessionEnd`): a Session that ends abnormally simply never gets its
// marker, and the sweep reads that absence rather than a local flag that died
// with the container.
//
// Silent and exit 0, and the lazy import, for the reasons `stop.mjs` gives: a
// hook's stderr lands in the transcript this product uploads, and `report.mjs`
// reaches `packages/shared`'s TypeScript that an old Node cannot load.

import { readConfiguration } from '../src/configuration.mjs'

const readStdin = async () => {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return input
}

try {
  const event = JSON.parse(await readStdin())
  const configuration = readConfiguration()

  const { flush } = await import('../src/report.mjs')

  await flush({
    configuration,
    transcriptPath: event.transcript_path,
    sessionId: event.session_id,
    cwd: event.cwd,
    environment: process.env,
    attach: {
      sessionEnd: {
        sessionId: event.session_id,
        // The Collector's clock: the event states no time, and a fixed value
        // makes a re-sent marker the same `session_events` row.
        occurredAt: new Date().toISOString(),
      },
    },
  })
} catch {
  // Deliberately silent: see above.
}
