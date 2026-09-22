// Ticket 33: what the Stop hook does, with the throwaway probe gone.
//
// One finished session, read from the transcript Claude Code names in the hook
// event, parsed by `packages/shared`, and reported to `/api/ingest` as this
// Device. Everything that decides an identity or a counter lives in `shared`
// (ADR 0001: the plugin is orchestration), so this file is the plumbing
// between a hook event and a request and nothing else.
//
// Plain `.mjs`, for the reason `configuration.mjs` gives: the hooks are run as
// `node <file>` with no bundler, so anything they import has to run as it is.
// The three modules from `shared` this needs are pure TypeScript with no
// imports of their own, which Node ≥22.18 executes directly by stripping the
// types — `session-start.mjs` says so at session start, and `stop.mjs` imports
// this file lazily so an older Node fails quietly rather than printing a stack
// trace on every turn.
//
// What this deliberately does not do yet: keep a cursor (ticket 37), report
// subagent runs (35, 36), or queue a failed report for retry (39). Until 37
// lands, a report carries the whole transcript every time and ingest absorbs
// the repeats — the identity index makes a re-report store nothing (ADR
// 0006), which is exactly the property a cursor is an optimisation over.

import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

import { archiveSession } from './archive.mjs'
import { readCursor, writeCursor } from './cursors.mjs'
import { drainQueue, enqueue } from './queue.mjs'
import { allSessions, sessionTranscripts } from './transcripts.mjs'
import { parseTranscript } from '../../shared/src/turns.ts'
import { deviceKey, projectKey } from '../../shared/src/identity.ts'
import {
  REPORTS_PER_PAYLOAD,
  TURNS_PER_REPORT,
} from '../../shared/src/limits.ts'

const run = promisify(execFile)

/** Long enough for a cold `git` on a large repository, short enough to stop. */
const GIT_TIMEOUT_MS = 2000

/**
 * `hooks.json` gives the hook ten seconds in total, and a `git` read plus a
 * request has to fit inside it with the file read: six and two leave two.
 * A transcript large enough to need several requests can still outrun that
 * and be killed — which costs nothing, because the next Stop re-reports and
 * ingest absorbs what already landed (ADR 0006).
 */
const REQUEST_TIMEOUT_MS = 6000

/**
 * How much of one transcript a single Stop reads.
 *
 * The delta is held in memory — as a buffer, a string, an array of lines and
 * then a payload — so an unbounded read is four unbounded allocations, and a
 * string past V8's ceiling throws into a hook that swallows everything. 32 MB
 * is far more than a turn and far less than a problem; what it does not reach
 * is reported by the next Stop, because the cursor it leaves behind is a real
 * position in the file.
 */
const READ_LIMIT = 32 * 1024 * 1024

/**
 * What a child process is allowed to see.
 *
 * `execFile` hands the child `process.env` by default, and this process holds
 * `SESSCLONE_API_KEY`. The child here is `git`, resolved through `PATH` and
 * run in a directory the *transcript* named — so a shim earlier on `PATH`, or
 * a `git.exe` inside a cloned repository on Windows, would be handed a live
 * credential, and anything running as this user could read it out of
 * `/proc/<pid>/environ`. Only what `git config` needs is passed.
 *
 * @param {Record<string, string | undefined>} environment
 */
const childEnvironment = (environment) => ({
  PATH: environment.PATH,
  HOME: environment.HOME,
  // Windows: `git` will not start without these two.
  SystemRoot: environment.SystemRoot,
  USERPROFILE: environment.USERPROFILE,
})

/**
 * The origin remote of the repository `cwd` sits in, or null.
 *
 * `git config --get` rather than `git remote get-url`: the first answers from
 * the configuration file alone, where the second resolves `insteadOf` rewrites
 * and can hand back a URL that names a different host to the one the Member's
 * colleagues would report — and two spellings of one remote are two Projects.
 *
 * Any failure is null, which is not a loss: a Session with no remote keys by
 * machine and path instead (`projectKey`), which is a real Project rather than
 * a missing one.
 *
 * @param {string | undefined} cwd
 * @param {Record<string, string | undefined>} environment
 * @returns {Promise<string | null>}
 */
export const originRemote = async (cwd, environment = process.env) => {
  if (!cwd) return null

  try {
    const { stdout } = await run(
      'git',
      ['config', '--get', 'remote.origin.url'],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        env: childEnvironment(environment),
      },
    )
    const remote = stdout.trim()
    return remote === '' ? null : remote
  } catch {
    return null
  }
}

/**
 * The transcript from `start` onwards, and the offset that text ends at.
 *
 * A transcript is append-only, so everything before the cursor has been
 * reported already and re-reading it is the cost ticket 37 exists to remove:
 * a steady-state Stop now reads the bytes of one turn rather than of the whole
 * session.
 *
 * Three rules decide what may be acknowledged, and all three exist to make a
 * lost Turn impossible:
 *
 * - **Only whole lines count.** A read races the writer — the session's own,
 *   and a subagent's file still being appended to while the parent's Stop
 *   scans for it — so the tail can be half an entry. `parseTranscript` drops a
 *   line that does not parse, so acknowledging those bytes would drop the Turn
 *   *and* step past it: the next Stop would read the remainder alone, which
 *   does not parse either, and that Turn would never be reported by anybody.
 *   The offset is therefore the last newline, and a complete final line with
 *   no newline is re-read once and absorbed by ADR 0006's index. It also keeps
 *   every offset line-aligned, so a multi-byte character cannot be split
 *   across two reads.
 * - **The offset has to land on a line boundary in *this* file.** A file
 *   shorter than the cursor was replaced rather than appended to, and so is a
 *   file of the same length whose bytes are different — a `--resume` into a
 *   rotated transcript, a restored container, a fork. Either way the byte
 *   before the offset is not a newline, and the file is read from the top.
 * - **One Stop reads a bounded amount.** The first report after an install
 *   carries a whole session; `READ_LIMIT` keeps that a bounded read rather
 *   than a file of unknown size in memory several times over. The rest is
 *   reported by the next Stop, from a cursor that is line-aligned by the rule
 *   above.
 *
 * @param {string} path
 * @param {number} start
 * @returns {Promise<{ text: string, byteOffset: number }>}
 */
const readFrom = async (path, start) => {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const from = (await resumable(handle, start, size)) ? start : 0
    const { buffer, bytesRead } = await handle.read({
      buffer: Buffer.alloc(Math.min(Math.max(size - from, 0), READ_LIMIT)),
      position: from,
    })

    const chunk = buffer.subarray(0, bytesRead)
    return {
      text: chunk.toString('utf8'),
      // A chunk with no newline in it acknowledges nothing: `lastIndexOf`
      // answers -1 and the offset stays where it was.
      byteOffset: from + chunk.lastIndexOf(0x0a) + 1,
    }
  } finally {
    await handle.close()
  }
}

/**
 * Whether `start` is a position in this file that can be resumed from: inside
 * it, and just past a newline. See `readFrom`.
 *
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {number} start
 * @param {number} size
 */
const resumable = async (handle, start, size) => {
  if (start <= 0 || start > size) return false
  const { buffer, bytesRead } = await handle.read({
    buffer: Buffer.alloc(1),
    position: start - 1,
  })
  return bytesRead === 1 && buffer[0] === 0x0a
}

/**
 * Groups in first-seen order, which is file order.
 *
 * @template T, K
 * @param {T[]} items
 * @param {(item: T) => K} key
 * @returns {Map<K, T[]>}
 */
const groupBy = (items, key) => {
  const groups = new Map()
  for (const item of items) {
    const at = key(item)
    const group = groups.get(at)
    if (group) group.push(item)
    else groups.set(at, [item])
  }
  return groups
}

/**
 * The Turns of one transcript, grouped by the Project they ran in, in file
 * order.
 *
 * One transcript is not one Project. Finding 74 records a session moving
 * between repositories mid-run — three working directories across two repos —
 * and finding 06's rule is that the directory is read off each entry rather
 * than off the session. Keying the whole file by its last Turn's directory
 * would file the earlier ones against a repository they never ran in, and
 * `on conflict do nothing` would then freeze that mistake.
 *
 * @param {import('@sessclone/shared').Turn[]} turns
 * @param {string | undefined} cwd The hook event's directory, as the fallback.
 * @param {Record<string, string | undefined>} environment
 */
const byProject = async (turns, cwd, environment) => {
  const groups = new Map()
  /** One `git` read per distinct directory, not one per Turn. */
  const remotes = new Map()

  for (const turn of turns) {
    // The entry's own `cwd` when it has one: a session that changed directory
    // recorded where it actually ran, and the hook's event says where it
    // started.
    const directory = turn.cwd ?? cwd ?? process.cwd()

    if (!remotes.has(directory)) {
      // eslint-disable-next-line no-await-in-loop -- one read per directory, and they are few
      remotes.set(directory, await originRemote(directory, environment))
    }

    const project = projectKey({
      cwd: directory,
      hostname: hostname(),
      remote: remotes.get(directory),
    })

    const group = groups.get(project.key)
    if (group) group.turns.push(turn)
    else groups.set(project.key, { project, turns: [turn] })
  }

  return [...groups.values()]
}

/**
 * The reports one transcript file is worth, in file order.
 *
 * One file is one Session or one Agent Run, but a report is per *identity*:
 * the Turns of a run are grouped by the `agentId` their own entries carry
 * (tickets 35 and 36 — a run is read from its own transcript, never inferred
 * from its parent's), then by the Project each Turn ran in, and then sliced to
 * the wire limit.
 *
 * @param {object} input
 * @param {{ path: string, agentRun: boolean, spawnDepth: number | null }} input.file
 * @param {string} input.sessionId
 * @param {string | undefined} input.cwd
 * @param {Record<string, string | undefined>} input.environment
 * @param {string} input.stateDir
 */
const reportsFor = async ({ file, sessionId, cwd, environment, stateDir }) => {
  let read
  try {
    const from = await readCursor(stateDir, file.path)
    read = await readFrom(file.path, from?.byteOffset ?? 0)
  } catch {
    // The files were listed a moment ago and are opened now: one can be gone
    // (Claude Code sweeps its own transcripts), locked on Windows, or
    // unreadable. Skipping it costs that file's Turns until the next Stop;
    // throwing would cost every file's, this Session's own included.
    return { reports: [], advance: null }
  }
  const { text, byteOffset } = read
  const turns = parseTranscript(text)

  // A Session's own file holds the main run only: a subagent's Turns are
  // reported from the file they were written to, so taking them from here as
  // well would file the same Turn twice — harmlessly, thanks to ADR 0006's
  // index, but with a cursor that acknowledges a position in the wrong file.
  const own = turns.filter(
    (turn) =>
      turn.sessionId === sessionId &&
      (file.agentRun ? turn.agentId !== null : turn.agentId === null),
  )
  if (own.length === 0) return { reports: [], advance: null }

  const last = own.at(-1)

  const reports = []
  /* oxlint-disable no-await-in-loop -- the `git` reads inside are cached per
     directory, and a run's Projects are resolved in file order. */
  for (const [agentId, theirs] of groupBy(own, (turn) => turn.agentId)) {
    for (const { project, turns: here } of await byProject(
      theirs,
      cwd,
      environment,
    )) {
      for (let at = 0; at < here.length; at += TURNS_PER_REPORT) {
        const slice = here.slice(at, at + TURNS_PER_REPORT)
        reports.push({
          sessionId,
          agentId,
          project: { key: project.key, remote: project.remote },
          cursor: {
            messageId: slice.at(-1).messageId,
            // Only the report carrying this file's last Turn has read to the
            // end of it. Every other one acknowledges no position at all
            // rather than one it cannot know, so a cursor can never advance
            // past Turns that were refused.
            byteOffset: slice.includes(last) ? byteOffset : 0,
          },
          // Read from the sidecar beside the transcript, never assumed to be
          // one: a run spawned by a run is deeper, and some runs state none.
          turns: slice.map((turn) => ({
            ...turn,
            spawnDepth: file.spawnDepth,
          })),
        })
      }
    }
  }
  /* oxlint-enable no-await-in-loop */
  return {
    reports,
    // Where this file has been read to, to be stored once the deployment has
    // accepted every report carrying it (ticket 37).
    advance: {
      path: file.path,
      cursor: { messageId: last.messageId, byteOffset },
    },
  }
}

/**
 * The payloads for the Session that just finished, and every Agent Run it
 * spawned. Empty when there is nothing to report.
 *
 * Several rather than one, because both wire limits are real and a report that
 * breaks one is a 400 that nothing looks at: a session past
 * `TURNS_PER_REPORT` Turns would otherwise be refused on every Stop for the
 * rest of its life, losing every Turn it ever produced — and a long session
 * reaches that by accumulation, since `--resume` appends to the same file
 * (finding 03). Those are the heaviest billers, so they are the last sessions
 * that may silently report nothing.
 *
 * Empty rather than a payload with no Turns: a transcript whose entries all
 * lack a message id — a session that ended before the first response — would
 * otherwise be a request the route refuses for carrying no cursor.
 *
 * @param {object} input
 * @param {string} input.transcriptPath
 * @param {string} input.sessionId
 * @param {string | undefined} input.cwd
 * @param {Record<string, string | undefined>} input.environment
 * @param {string} input.stateDir Where the cursors live.
 * @returns {Promise<{ payload: import('@sessclone/shared').IngestPayload, advance: { path: string, cursor: { messageId: string, byteOffset: number } }[] }[]>}
 */
export const buildPayloads = async ({
  transcriptPath,
  sessionId,
  cwd,
  environment,
  stateDir,
}) => {
  const files = await sessionTranscripts({
    transcriptPath,
    sessionId,
    environment,
  })

  const reports = []
  /** Which file each report came from, so a cursor advances only on success. */
  const sources = []
  const advances = new Map()

  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop -- a handful of files, read in order
    const { reports: theirs, advance } = await reportsFor({
      file,
      sessionId,
      cwd,
      environment,
      stateDir,
    })
    if (advance) advances.set(advance.path, advance.cursor)
    for (const report of theirs) {
      reports.push(report)
      sources.push(file.path)
    }
  }
  if (reports.length === 0) return []

  const device = { key: deviceKey({ hostname: hostname(), environment }) }
  const payloads = []
  for (let at = 0; at < reports.length; at += REPORTS_PER_PAYLOAD) {
    const carried = sources.slice(at, at + REPORTS_PER_PAYLOAD)
    payloads.push({
      payload: {
        device,
        reports: reports.slice(at, at + REPORTS_PER_PAYLOAD),
      },
      /** The transcripts this request carries, and where each was read to. */
      advance: [...new Set(carried)].map((path) => ({
        path,
        cursor: advances.get(path),
      })),
    })
  }
  return payloads
}

/**
 * Reads the Session that just finished (and its Agent Runs) from the cursor,
 * sends each payload, and advances a transcript's cursor only once every
 * request carrying it was accepted.
 *
 * This is the body both `Stop` and `SessionEnd` run: a completed turn fires
 * `Stop`, and `SessionEnd` is the belt to that suspenders — the last chance to
 * push whatever the cursor is still behind on when the session ends, whether
 * because a `Stop` report failed (ticket 39's queue is not built yet) or
 * because the session ended on something other than a turn (`/clear`, a fork).
 * It reads from the same cursors `Stop` writes, so running both is not double
 * counting: the second finds nothing past the first.
 *
 * A refusal disqualifies the whole file, not just the request that carried the
 * refusal: one transcript's reports can span two requests, and advancing on
 * the first would step the cursor past Turns the second never landed — the one
 * mistake here that loses data. Everything is caught by the caller; on an
 * unsupported Node the lazy import that reached this file already threw.
 *
 * `attach` is the `SessionEnd` completeness marker (`{ sessionEnd }`), sent in
 * a request of its own **after** the flush and **only when nothing was
 * refused**. The marker's meaning is "this Session finished and need not be
 * re-read", so writing it while any Turn of the session was refused — and its
 * cursor deliberately held back — would tell the deployment the session is done
 * when it is not, which a sweep would honour by skipping the un-flushed Turns.
 * A partial flush therefore writes no marker; the next Stop or `SessionEnd`
 * flushes the rest and marks it then. Its own send moves no cursor.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {string} input.transcriptPath
 * @param {string} input.sessionId
 * @param {string | undefined} input.cwd
 * @param {Record<string, string | undefined>} input.environment
 * @param {Partial<import('@sessclone/shared').IngestPayload>} [input.attach]
 */
export const flush = async ({
  configuration,
  transcriptPath,
  sessionId,
  cwd,
  environment,
  attach = {},
}) => {
  const plans = await buildPayloads({
    transcriptPath,
    sessionId,
    cwd,
    environment,
    stateDir: configuration.stateDir,
  })

  /** Where each transcript has been read to, and which ones were refused. */
  const acknowledged = new Map()
  const refused = new Set()

  for (const { payload, advance } of plans) {
    // eslint-disable-next-line no-await-in-loop -- one request at a time; firing them together is how a Collector takes a deployment down
    const { ok } = await send({ configuration, payload })
    for (const { path, cursor } of advance) {
      if (ok) acknowledged.set(path, cursor)
      else refused.add(path)
    }
  }

  for (const [path, cursor] of acknowledged) {
    if (cursor && !refused.has(path)) {
      // eslint-disable-next-line no-await-in-loop -- a handful of files
      await writeCursor(configuration.stateDir, path, cursor)
    }
  }

  // The completeness marker last, and only when the whole flush landed. With
  // nothing to flush (the clean case) `refused` is empty and this is the one
  // request; with several turn-requests it is a rare extra round trip, taken
  // rather than write a marker that would lie about a partial flush.
  //
  // Delivered rather than sent: a `session_end` marker (and a `stop_failure`)
  // reads no transcript and moves no cursor, so unlike a Turn nothing re-reads
  // it — the retry-and-queue in `deliver` is its only durability. Turns above
  // use `send`, because their cursor held on a failure and the next `Stop` or
  // the sweep re-reads them, so queueing them too would only duplicate what the
  // cursor already recovers.
  if (Object.keys(attach).length > 0 && refused.size === 0) {
    await deliver({
      configuration,
      payload: {
        device: { key: deviceKey({ hostname: hostname(), environment }) },
        reports: [],
        ...attach,
      },
    })
  }
}

/**
 * How long the `SessionStart` sweep may run before it stops, in milliseconds.
 *
 * The hook has ten seconds (`hooks.json`); the sweep drains the queue and then
 * re-flushes sessions until this budget is spent, newest first, so a laptop
 * with a year of transcripts recovers the recent ones — the ones with an
 * unflushed tail — without the hook being killed mid-request. What it does not
 * reach this start is reached by the next one: `allSessions` is newest-first
 * and every flush reads from a cursor, so the work is resumable and idempotent.
 */
export const SWEEP_BUDGET_MS = 8000

/**
 * The `SessionStart` recovery pass (spec §5.2).
 *
 * Two jobs. First drain the retry queue: a `stop_failure` or `session_end`
 * marker that never landed has no transcript to be re-read from, so the queue
 * is its only durability and the drain is where it finally goes. Then re-flush
 * every session this environment has written, newest first and time-boxed —
 * each from its own cursor, so a session whose final `Stop` never landed sends
 * its unflushed tail, a session that predates the install sends its whole
 * history (no cursor means read from the top), and a session already flushed to
 * its end sends nothing and costs one bounded read.
 *
 * The queue drains first so a deployment that just came back gets the markers
 * it is missing before the sweep spends its budget re-reading transcripts, and
 * the drain shares the same time box (a slow-but-reachable deployment must not
 * let the drain alone outrun the hook). Both fail soft: an unreachable
 * deployment leaves the queue in place and holds every cursor, and the next
 * start retries.
 *
 * `now` and the flush's transport are the only clocks, so a test proves the
 * budget and the idempotence with no real delay.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {Record<string, string | undefined>} [input.environment]
 * @param {() => number} [input.now]
 * @param {number} [input.budgetMs]
 */
export const sweep = async ({
  configuration,
  environment = process.env,
  now = Date.now,
  budgetMs = SWEEP_BUDGET_MS,
}) => {
  const deadline = now() + budgetMs
  const overBudget = () => now() >= deadline

  await drainQueue(
    configuration.stateDir,
    (payload) => send({ configuration, payload }),
    overBudget,
  )

  const sessions = await allSessions(environment)
  for (const { sessionId, transcriptPath } of sessions) {
    if (overBudget()) break
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: firing every session's flush at once is how a Collector takes a deployment down, and the budget is checked between each
    await flush({
      configuration,
      transcriptPath,
      sessionId,
      // A swept session is not the hook's own: each Turn carries the directory
      // it ran in (`turn.cwd`), so there is no session-wide cwd to pass.
      cwd: undefined,
      environment,
    })

    // Ticket 59: and archive it, for the Member who has opted in. Turns come
    // first — they are what the dashboard is for, and they are small — so a
    // budget spent on one large upload costs at worst a transcript that the
    // next start picks up, never a Turn. A Member who has not opted in pays
    // one small refused request per session here and nothing else.
    if (overBudget()) break
    // eslint-disable-next-line no-await-in-loop -- as above, and the budget is checked between each
    await archiveSession({
      configuration,
      transcriptPath,
      sessionId,
      environment,
      shouldStop: overBudget,
    })
  }
}

/**
 * Delays before each in-hook retry, in milliseconds (spec §5.4).
 *
 * A transient blip — a proxy reconnecting, a laptop's wifi settling — is worth
 * three quick retries; a deployment that is down fails each instantly
 * (`ECONNREFUSED`), so the whole sequence is under three seconds and inside the
 * hook's ten. A server that accepts the connection and then stalls is the one
 * case that can outrun the budget and be killed mid-retry — which costs
 * nothing, because the cursor has not advanced and the next `Stop` or the sweep
 * re-reads (ticket 37).
 */
export const RETRY_DELAYS_MS = [100, 500, 2000]

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sends a payload, retries it a few times, and queues it if it still will not
 * go. This is what the hooks call: `send` is the single attempt underneath.
 *
 * A queued payload is durability, not delivery — `deliver` returns the *last*
 * send's result, so the caller advances a cursor only on a real acknowledgement
 * and never because a payload reached the queue. That keeps the cursor honest:
 * a queued Turn is re-read later and absorbed by ADR 0006, and a queued session
 * event is delivered by the drain with its bytes unchanged (ticket 40's
 * `occurredAt` note).
 *
 * `sleep` is injectable so a test proves the backoff without waiting on it.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {import('@sessclone/shared').IngestPayload} input.payload
 * @param {(ms: number) => Promise<void>} [input.sleep]
 * @returns {Promise<{ ok: boolean; status: number | null; queued: boolean }>}
 */
export const deliver = async ({ configuration, payload, sleep = wait }) => {
  let result = await send({ configuration, payload })
  for (const delay of RETRY_DELAYS_MS) {
    if (result.ok) break
    // A refusal (4xx) is final: retrying identical bytes earns the identical
    // refusal, and it does not belong in the queue either.
    if (result.status !== null && result.status >= 400 && result.status < 500) {
      return { ...result, queued: false }
    }
    // eslint-disable-next-line no-await-in-loop -- a backoff is sequential by definition
    await sleep(delay)
    // eslint-disable-next-line no-await-in-loop -- one attempt at a time
    result = await send({ configuration, payload })
  }

  if (!result.ok) {
    await enqueue(configuration.stateDir, payload)
    return { ...result, queued: true }
  }
  return { ...result, queued: false }
}

/**
 * Reports one payload. Resolves either way.
 *
 * The API key travels in the `Authorization` header and nowhere else, so it
 * is not in a body anything might log — and it is never written to stderr,
 * because a hook's stderr lands in the transcript this product then uploads.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {import('@sessclone/shared').IngestPayload} input.payload
 * @returns {Promise<{ ok: boolean; status: number | null }>}
 */
export const send = async ({ configuration, payload }) => {
  try {
    const answer = await fetch(`${configuration.url}/api/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${configuration.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return { ok: answer.ok, status: answer.status }
  } catch {
    // A deployment that is down, a laptop on a train. Ticket 39 is the queue
    // that makes this recoverable; until then the next Stop re-reports the
    // whole transcript, which ingest absorbs.
    return { ok: false, status: null }
  }
}
