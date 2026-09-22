// Ticket 99: in a cloud container, archive the transcript after every turn.
//
// Archival otherwise runs at `SessionEnd` and in the next `SessionStart`
// sweep (ticket 59), and a Claude Code cloud container gets neither: it never
// runs `SessionEnd`, archive and reclaim included (ticket 95), and the next
// session starts in a fresh container that has none of this one's files. So a
// cloud transcript was never uploaded at all.
//
// Registered beside `stop.mjs` with `async: true`, so the turn never waits on
// an upload and Claude Code enforces no timeout on it (it can still kill one at
// teardown, which a reclaimed container is anyway). The whole file goes
// each time and replaces the one object the Session has (ADR 0003), so the
// stored copy is at most one turn behind — a container reclaimed mid-turn
// loses that turn's lines, never the rest. The deployment still decides:
// nothing leaves the machine unless this Member has opted in.
//
// Local machines are skipped before anything else runs: `SessionEnd` and the
// sweep already cover them, and a full upload per turn is bytes they need not
// spend. Silent and exit 0 for the reasons `stop.mjs` gives.

import { archiveAfterTurn, archivesEveryTurn } from '../src/archive.mjs'
import { readConfiguration } from '../src/configuration.mjs'
import { debugFailure } from '../src/debug.mjs'
import { deadlineIn } from '../src/deadline.mjs'
import { throughProxy } from '../src/proxy.mjs'

/**
 * How long this hook may run, in milliseconds. Claude Code enforces no timeout
 * on a running async hook, so this is only what stops a stalled upload from
 * leaving an orphan behind. It includes any wait for the previous turn's run.
 */
const HOOK_BUDGET_MS = 60_000

/**
 * How long one upload may take. Far above the eight seconds a synchronous
 * hook can spare, because a long cloud Session's transcript is megabytes and
 * goes whole every turn: at eight seconds a large one would fail every time.
 */
const UPLOAD_BUDGET_MS = 50_000

const readStdin = async () => {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  return input
}

if (archivesEveryTurn(process.env)) {
  // Ticket 98: the upload has to go through the proxy too.
  throughProxy()
  const deadline = deadlineIn(HOOK_BUDGET_MS)
  try {
    const event = JSON.parse(await readStdin())
    await archiveAfterTurn({
      configuration: readConfiguration(),
      transcriptPath: event.transcript_path,
      sessionId: event.session_id,
      environment: process.env,
      deadline,
      uploadTimeoutMs: UPLOAD_BUDGET_MS,
    })
  } catch (error) {
    // Deliberately silent unless somebody is looking: see `src/debug.mjs`.
    debugFailure('the per-turn archive', error)
  }
}
