// Ticket 33: the Stop hook reports the Turns of the session that just
// finished. Ticket 02's probe — one row carrying a session id and nothing
// else — is gone, along with the route and the table it wrote to.
//
// Every failure is swallowed and the exit code is always 0. Not because a
// throw would block the turn — only exit 2 blocks a `Stop` hook, and an
// uncaught throw exits 1 — but because a non-zero exit prints a hook error
// notice on every turn, which is a poor way to report that a deployment is
// down. The Collector's answer is `session-start.mjs`, which says it once,
// and the retry queue of ticket 39.
//
// Nothing here writes to stderr either, and that is not the same decision: a
// hook's output lands in the transcript this product uploads, so a message
// about a failed report would end up inside the next report.
//
// `report.mjs` is imported inside the `try` rather than at the top, and that
// is what makes those two true on an unsupported Node: it reaches
// `packages/shared`'s TypeScript, which a Node below 22.18 cannot load, and a
// top-level import throws before any handler exists — printing the stack
// trace on every turn, into the next transcript.

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
  })
} catch {
  // Deliberately silent: see above.
}
