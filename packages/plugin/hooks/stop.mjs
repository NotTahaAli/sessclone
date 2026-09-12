// Ticket 02's tracer bullet: one row per finished turn, carrying nothing but
// the session id. Ticket 23 replaces the body with the real collector — read
// the transcript from the cursor, send the turns, retry, queue.
//
// Every failure is swallowed and the exit code is always 0. Not because a
// throw would block the turn — only exit 2 blocks a `Stop` hook, and an
// uncaught throw exits 1 — but because a non-zero exit prints a hook error
// notice on every turn, which is a poor way to report that a deployment is
// down. The collector's answer is the retry queue, not a louder hook.

const url = process.env.SESSCLONE_URL ?? 'http://127.0.0.1:3000'

const readStdin = async () => {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return input
}

try {
  const event = JSON.parse(await readStdin())
  await fetch(`${url}/api/probe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: event.session_id }),
    signal: AbortSignal.timeout(5000),
  })
} catch {
  // Deliberately silent: see above.
}
