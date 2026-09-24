// Ticket 59: archiving a transcript off the machine.
//
// Three requests per transcript, and the order is the whole design (ADR 0003):
//
// 1. `POST /api/logs/presign` with the transcript's SHA-256. The deployment
//    decides — the Tier, the Member's own switch, that Project's exception,
//    and whether these exact bytes are already stored — and answers with a
//    short-lived PUT URL or a reason.
// 2. The `PUT`, straight to storage. The bytes never pass through the
//    application, and they are streamed rather than read into memory: a
//    transcript is source code and can be tens of megabytes.
// 3. `POST /api/logs/confirm`, which is what writes the row. It is a second
//    request because the PUT between them is the part that fails — and a row
//    written before the bytes landed would claim a transcript is stored that
//    is not, after which the hash guard in step 1 would refuse to upload it
//    ever again.
//
// **Nothing leaves the machine before step 1 says yes.** That is what makes
// archival opt-in without the Collector holding a copy of the switch: the
// master switch, the Project exception and the Tier all live in the
// deployment, so a Member who has not opted in gets `archival_off` here and
// the file is never opened for reading past its hash.
//
// Every refusal is quiet and costs nothing. There is no queue and no retry
// list: a transcript is on disk, its hash is cheap, and the next `SessionEnd`
// or `SessionStart` sweep asks again. An unchanged transcript is refused with
// `unchanged` at the cost of one small request, which is the property that
// keeps a sweep over a year of history from re-uploading all of it.

import { createReadStream } from 'node:fs'
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

import { NO_DEADLINE, expired, requestSignal } from './deadline.mjs'
import { MAX_SEAL } from './shared/limits.ts'
import { sessionFiles } from './transcripts.mjs'

/**
 * How long one archival request may take.
 *
 * The hook has ten seconds in total (`hooks.json`) and the sweep's budget is
 * checked between transcripts, so one slow upload must not eat the whole hook:
 * a transcript that cannot be sent in eight seconds is left for the next
 * opportunity, which costs nothing because nothing has been recorded.
 */
export const UPLOAD_TIMEOUT_MS = 8000

/**
 * Whether this machine archives after every turn rather than at the end
 * (ticket 99): a Claude Code cloud container, which never runs `SessionEnd`
 * and takes its files with it. The same test `deviceKey` makes for a cloud
 * Device, minus the account, which the upload does not need.
 *
 * @param {Record<string, string | undefined>} environment
 */
export const archivesEveryTurn = (environment) =>
  environment.CLAUDE_CODE_REMOTE?.trim() === 'true'

/** The small requests either side of the upload. */
const REQUEST_TIMEOUT_MS = 4000

/**
 * The SHA-256 of the first `size` bytes of a file, lowercase hex, streamed.
 *
 * Bounded, and that is the point: a transcript being appended to by a session
 * running right now grows between the hash and the upload, and a `PUT` whose
 * stream yields more bytes than its `content-length` declared fails *after*
 * the bytes have been sent. So the size is taken once and both the hash and
 * the upload read exactly that range — the bytes uploaded are the bytes
 * hashed, by construction.
 *
 * Streamed rather than read: this runs against every transcript a sweep
 * touches, and reading each one into memory to hash it is the allocation the
 * Collector spends its whole budget avoiding elsewhere.
 *
 * @param {string} path
 * @param {number} size
 * @returns {Promise<string | null>} Null when the file cannot be read.
 */
export const hashFile = async (path, size) => {
  if (size === 0) return createHash('sha256').digest('hex')
  const digest = createHash('sha256')
  try {
    await pipeline(createReadStream(path, { start: 0, end: size - 1 }), digest)
  } catch {
    return null
  }
  return digest.digest('hex')
}

/** How much raw transcript a sealed chunk holds, at least (ADR 0008). */
export const CHUNK_BYTES = 1024 * 1024

/**
 * Where the next chunks end, as exclusive raw offsets (ADR 0008). Pure.
 *
 * A chunk starting at `from` ends just after the first `\n` at or after
 * `from + chunkBytes - 1`, so it holds at least `chunkBytes` and never splits a
 * line: a line longer than that makes a longer chunk, and bytes after the last
 * line end stay in the tail. At most `max` cuts.
 *
 * `bytes` may be one piece of a longer file, starting at raw offset `at`: the
 * streaming read below plans each piece as it arrives, with `from` the start
 * of a chunk that may have begun in an earlier piece.
 *
 * @param {Buffer} bytes
 * @param {number} from
 * @param {{ at?: number, chunkBytes?: number, max?: number }} [options]
 * @returns {number[]}
 */
export const sealPlan = (
  bytes,
  from,
  { at = 0, chunkBytes = CHUNK_BYTES, max = MAX_SEAL } = {},
) => {
  const ends = []
  let start = from
  while (ends.length < max) {
    const newline = bytes.indexOf(
      0x0a,
      Math.max(0, start + chunkBytes - 1 - at),
    )
    if (newline === -1) break
    start = at + newline + 1
    ends.push(start)
  }
  return ends
}

/**
 * Reads `[0, size)` once, checking the sealed prefix and planning what to seal
 * after it (ADR 0008).
 *
 * `'mismatch'` when the file is shorter than the sealed bytes or its prefix
 * hashes differently: rewritten or truncated, so the caller falls back to the
 * whole file. Null when the file cannot be read. Otherwise the new chunks, in
 * order from seq `sealed.chunks + 1`, and the SHA-256 of every raw byte up to
 * the last of them. Streamed: only the piece being read is in memory.
 *
 * @param {string} path
 * @param {number} size
 * @param {{ bytes: number, sha256: string | null, chunks: number }} sealed
 * @param {{ chunkBytes?: number }} [options]
 */
export const planSeals = async (path, size, sealed, { chunkBytes } = {}) => {
  if (size < sealed.bytes) return 'mismatch'
  const all = createHash('sha256')
  let piece = createHash('sha256')
  let matched = sealed.bytes === 0
  let start = sealed.bytes
  let sealedSha256 = sealed.sha256
  /** @type {{ seq: number, rawOffset: number, rawLength: number, sha256: string }[]} */
  const chunks = []
  let position = 0
  try {
    if (size > 0) {
      for await (const bytes of createReadStream(path, {
        start: 0,
        end: size - 1,
      })) {
        let used = 0
        if (!matched) {
          used = Math.min(bytes.length, sealed.bytes - position)
          all.update(bytes.subarray(0, used))
          if (position + used === sealed.bytes) {
            if (all.copy().digest('hex') !== sealed.sha256) return 'mismatch'
            matched = true
          }
        }
        if (matched) {
          const cuts = sealPlan(bytes, start, {
            at: position,
            chunkBytes,
            max: MAX_SEAL - chunks.length,
          })
          for (const end of cuts) {
            const part = bytes.subarray(used, end - position)
            all.update(part)
            piece.update(part)
            chunks.push({
              seq: sealed.chunks + chunks.length + 1,
              rawOffset: start,
              rawLength: end - start,
              sha256: piece.digest('hex'),
            })
            sealedSha256 = all.copy().digest('hex')
            piece = createHash('sha256')
            start = end
            used = end - position
          }
          if (chunks.length === MAX_SEAL) break
          all.update(bytes.subarray(used))
          piece.update(bytes.subarray(used))
        }
        position += bytes.length
      }
    }
  } catch {
    return null
  }
  // A file that shrank after its size was taken never reached the prefix.
  if (!matched) return 'mismatch'
  return { chunks, sealedSha256 }
}

/**
 * Raw `[start, start + length)` gzipped, streamed through zlib; only the
 * compressed result is collected, because a presigned PUT needs its length.
 *
 * @param {string} path
 * @param {number} start
 * @param {number} length
 * @returns {Promise<Buffer>}
 */
export const gzipRange = async (path, start, length) => {
  const parts = []
  await pipeline(
    createReadStream(path, { start, end: start + length - 1 }),
    createGzip(),
    async (source) => {
      for await (const part of source) parts.push(part)
    },
  )
  return Buffer.concat(parts)
}

/**
 * The file remembering what happened to one transcript, named as a cursor is
 * and for the same reason: a transcript path carries a Member's own directory
 * names, and this is a filename rather than a record of where anybody works.
 *
 * @param {string} stateDir
 * @param {string} transcriptPath
 */
const outcomePath = (stateDir, transcriptPath) =>
  join(
    stateDir,
    'archived',
    `${createHash('sha256').update(transcriptPath).digest('hex').slice(0, 32)}.json`,
  )

/**
 * What the last attempt on this transcript did, or null.
 *
 * A cache and never a record, exactly as a cursor is: every failure resolves
 * to null, which costs a hash and a small request and never a transcript.
 *
 * @param {string} stateDir
 * @param {string} transcriptPath
 */
export const readOutcome = async (stateDir, transcriptPath) => {
  try {
    const stored = JSON.parse(
      await readFile(outcomePath(stateDir, transcriptPath), 'utf8'),
    )
    return typeof stored?.sha256 === 'string' &&
      Number.isInteger(stored?.size) &&
      typeof stored?.outcome === 'string'
      ? stored
      : null
  } catch {
    return null
  }
}

/**
 * Records what happened, so the next pass can skip the work. Resolves either
 * way.
 *
 * @param {string} stateDir
 * @param {string} transcriptPath
 * @param {{ size: number, mtimeMs: number, sha256: string, outcome: string }} outcome
 */
export const writeOutcome = async (stateDir, transcriptPath, outcome) => {
  const path = outcomePath(stateDir, transcriptPath)
  try {
    await mkdir(join(stateDir, 'archived'), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(outcome), { mode: 0o600 })
    await rename(temporary, path)
  } catch {
    // A read-only state directory costs a re-hash and a refused request per
    // pass, never a transcript.
  }
}

/**
 * The outcomes worth not repeating while the file has not changed.
 *
 * `unchanged` is the deployment saying these exact bytes are already stored,
 * and the four refusals below are switches only a person can flip. Repeating
 * any of them on an unchanged file buys nothing and costs a full read of it —
 * which on a year of history is gigabytes inside a ten-second hook.
 *
 * `not_uploaded`, `unconfirmed`, `upload_failed`, `stale_key` and
 * `unavailable` are deliberately absent: those are the transient ones, and
 * retrying them is the whole recovery path.
 */
const SETTLED = new Set([
  'archived',
  'unchanged',
  'archival_off',
  'project_excluded',
  'tier_excludes_archival',
])

/**
 * The Agent Run id a transcript's filename carries, or null for a Session's
 * own transcript.
 *
 * The id inside the entries is the same one, but reading it would mean parsing
 * the file to decide where to store it — and `agent-<id>.jsonl` is the name
 * Claude Code writes (finding 74), which is what the object key is built from
 * on the other end.
 *
 * @param {string} path
 */
export const agentIdOf = (path) => {
  const name = basename(path)
  const match = /^agent-(.+)\.jsonl$/.exec(name)
  return match ? match[1] : null
}

/**
 * One small JSON request to the deployment, with the key in the header and
 * nowhere else.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {string} input.path
 * @param {unknown} input.body
 * @param {number} [input.deadline]
 * @returns {Promise<{ ok: boolean, status: number | null, body: any }>}
 */
const ask = async ({ configuration, path, body, deadline = NO_DEADLINE }) => {
  try {
    const answer = await fetch(`${configuration.url}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${configuration.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: requestSignal(REQUEST_TIMEOUT_MS, deadline),
    })
    const parsed = await answer.json().catch(() => null)
    return { ok: answer.ok, status: answer.status, body: parsed }
  } catch {
    return { ok: false, status: null, body: null }
  }
}

/**
 * Archives one transcript, or says why it did not.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {string} input.transcriptPath
 * @param {string} input.sessionId
 * @param {string | null} [input.agentId]
 * @param {'transcript' | 'agent_meta' | 'workflow_journal'} [input.kind]
 *   What the file is (ticket 104); a sidecar rides exactly this path.
 * @param {number} [input.deadline]
 * @param {number} [input.uploadTimeoutMs] The PUT's own limit.
 * @returns {Promise<{ archived: boolean, refused?: string, sizeBytes?: number }>}
 */
export const archiveTranscript = async ({
  configuration,
  transcriptPath,
  sessionId,
  agentId = agentIdOf(transcriptPath),
  kind = 'transcript',
  deadline = NO_DEADLINE,
  uploadTimeoutMs = UPLOAD_TIMEOUT_MS,
}) => {
  // The size first, and once: everything below reads exactly this range, so a
  // transcript that grows underneath is archived as it stood here and the next
  // pass takes the rest.
  let stats
  try {
    stats = await stat(transcriptPath)
  } catch {
    return { archived: false, refused: 'unreadable' }
  }
  const size = stats.size

  // A file that has not changed since an outcome nothing can improve on: no
  // hash, no request. This is what keeps a sweep over a year of transcripts
  // from re-reading all of them to be told `unchanged` again.
  const last = await readOutcome(configuration.stateDir, transcriptPath)
  if (
    last &&
    last.size === size &&
    last.mtimeMs === stats.mtimeMs &&
    SETTLED.has(last.outcome)
  ) {
    return last.outcome === 'archived'
      ? { archived: true, skipped: true }
      : { archived: false, refused: last.outcome, skipped: true }
  }

  const sha256 = await hashFile(transcriptPath, size)
  if (!sha256) return { archived: false, refused: 'unreadable' }

  /** Remembers what happened, keyed on the file as it was read. */
  const settle = async (outcome) => {
    await writeOutcome(configuration.stateDir, transcriptPath, {
      size,
      mtimeMs: stats.mtimeMs,
      sha256,
      outcome,
    })
  }

  const presign = await ask({
    configuration,
    path: '/api/logs/presign',
    body: { sessionId, agentId, kind, sha256 },
    deadline,
  })

  // Anything that is not an issued URL — a refusal, a 401, a deployment with
  // no storage, an unreachable host — ends here without the file being opened.
  if (!presign.ok) return { archived: false, refused: 'unavailable' }
  if (presign.body?.refused) {
    await settle(presign.body.refused)
    return { archived: false, refused: presign.body.refused }
  }
  if (!presign.body?.url || !presign.body?.storageKey) {
    return { archived: false, refused: 'unavailable' }
  }
  // A deployment older than ticket 104 strips `kind` and would file a sidecar
  // as the run's transcript, overwriting it. Newer ones echo the kind they
  // presigned for, so a sidecar goes only where the answer says so; otherwise
  // it is skipped, unsettled, and asked about again once the server upgrades.
  if (kind !== 'transcript' && presign.body.kind !== kind) {
    return { archived: false, refused: 'kind_unsupported' }
  }

  try {
    const answer = await fetch(presign.body.url, {
      method: 'PUT',
      headers: {
        'content-type':
          kind === 'agent_meta' ? 'application/json' : 'application/x-ndjson',
        // Exactly the range that was hashed. A stream that yielded more or
        // fewer bytes than this fails the request after sending them, which is
        // what a transcript being appended to by a live session would do.
        'content-length': String(size),
      },
      body: Readable.toWeb(
        createReadStream(transcriptPath, { start: 0, end: size - 1 }),
      ),
      // Node requires this for a streamed request body.
      duplex: 'half',
      signal: requestSignal(uploadTimeoutMs, deadline),
    })
    if (!answer.ok) return { archived: false, refused: 'upload_failed' }
  } catch {
    return { archived: false, refused: 'upload_failed' }
  }

  const confirm = await ask({
    configuration,
    path: '/api/logs/confirm',
    // The key the bytes actually went to, echoed so the deployment can refuse
    // a Session that moved Project since the presign rather than record one
    // object under another's hash.
    body: {
      sessionId,
      agentId,
      kind,
      sha256,
      storageKey: presign.body.storageKey,
    },
    deadline,
  })
  if (!confirm.ok || !confirm.body?.stored) {
    if (confirm.body?.refused) {
      // A refusal here is transient by construction (`stale_key`,
      // `not_uploaded`): remembered only so a status surface can say what
      // happened, never treated as settled.
      return { archived: false, refused: confirm.body.refused }
    }
    // The bytes are in the bucket and no row names them. The next pass
    // re-uploads and re-confirms, which is why the object is replaced in place
    // rather than versioned: a repeat costs the upload again and never a
    // second object.
    return { archived: false, refused: 'unconfirmed' }
  }

  await settle('archived')
  return { archived: true, sizeBytes: confirm.body.sizeBytes }
}

/**
 * Archives every transcript one Session wrote: its own, and one per Agent Run.
 *
 * Sequential, and bounded by `deadline`, for the same reason the sweep is: a
 * Session with twenty subagent runs must not fire twenty uploads at once, and
 * the hook it runs inside has ten seconds. The deadline bounds each request as
 * well as the loop — an upload started just inside it would otherwise run for
 * its own eight seconds and be killed with the hook.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {string | undefined} input.transcriptPath
 * @param {string} input.sessionId
 * @param {Record<string, string | undefined>} input.environment
 * @param {number} [input.deadline]
 * @param {number} [input.uploadTimeoutMs]
 */
export const archiveSession = async ({
  configuration,
  transcriptPath,
  sessionId,
  environment,
  deadline = NO_DEADLINE,
  uploadTimeoutMs,
}) => {
  const { transcripts, sidecars } = await sessionFiles({
    transcriptPath,
    sessionId,
    environment,
  })

  // The transcripts first, then their sidecars (ticket 104): a deadline that
  // runs out part-way should cost a run's metadata before a transcript.
  const work = [
    ...transcripts.map(({ path, agentRun }) => ({
      path,
      // The id comes from the filename, and an Agent Run whose filename does
      // not carry one is skipped rather than archived: `agentId: null` would
      // file it under the *Session's* own key and replace the Session's
      // transcript with it, and the two would then overwrite each other on
      // every pass.
      agentId: agentIdOf(path),
      agentRun,
      kind: 'transcript',
    })),
    ...sidecars.map((sidecar) => ({ ...sidecar, agentRun: true })),
  ]

  let archived = 0
  /** What happened per file, for a caller with somewhere to show it. */
  const refusals = []

  for (const { path, agentId, agentRun, kind } of work) {
    if (expired(deadline)) break
    if (agentRun && agentId === null) continue

    // eslint-disable-next-line no-await-in-loop -- one upload at a time, on purpose
    const result = await archiveTranscript({
      configuration,
      transcriptPath: path,
      sessionId,
      agentId,
      kind,
      deadline,
      uploadTimeoutMs,
    })
    if (result.archived) archived += 1
    else if (result.refused) refusals.push(result.refused)
  }
  return { archived, refusals }
}

/** How long a per-turn lock is trusted before it is taken as a dead run's. */
const TURN_LOCK_STALE_MS = 120_000

/** How often a waiting run looks at the lock again. */
const TURN_LOCK_POLL_MS = 500

/** How long to give the `Stop` flush before asking again after `no_turns`. */
export const NO_TURNS_RETRY_MS = 3000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Takes the per-Session lock, waiting for a run still holding it. True when
 * this run may go ahead — including when the state directory cannot hold a
 * lock at all, which costs an overlap and never a transcript.
 *
 * @param {string} path
 * @param {number} deadline
 */
const takeLock = async (path, deadline) => {
  try {
    await mkdir(dirname(path), { recursive: true })
  } catch {
    return true
  }
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one attempt at a time is the lock
      await (await open(path, 'wx')).close()
      return true
    } catch (error) {
      if (error?.code !== 'EEXIST') return true
    }
    // eslint-disable-next-line no-await-in-loop -- as above
    const age = await stat(path).then(
      (stats) => Date.now() - stats.mtimeMs,
      () => 0,
    )
    // A run that died holding it: take it over.
    // eslint-disable-next-line no-await-in-loop -- as above
    if (age >= TURN_LOCK_STALE_MS) await rm(path, { force: true })
    else if (expired(deadline - TURN_LOCK_POLL_MS)) return false
    // eslint-disable-next-line no-await-in-loop -- as above
    else await sleep(TURN_LOCK_POLL_MS)
  }
}

/**
 * Ticket 99: archives a cloud Session after one of its turns.
 *
 * Two things `archiveSession` alone gets wrong when it runs after every turn,
 * in the background, beside the `Stop` flush:
 *
 * - **Runs overlap.** A quick next turn starts a second run while the first is
 *   still uploading, and two runs can confirm in the opposite order to their
 *   PUTs, leaving the row naming bytes the object no longer holds. So runs for
 *   one Session take a lock, and a later run waits for the earlier one rather
 *   than skipping — the later run is the one holding the newest bytes.
 * - **The flush may not have landed.** The presign refuses a Session with no
 *   Turns yet (`no_turns`), which on a first turn is a race with the flush
 *   started at the same moment. One retry after a short wait covers it; a
 *   single-turn Session would otherwise never be archived.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {string | undefined} input.transcriptPath
 * @param {string} input.sessionId
 * @param {Record<string, string | undefined>} input.environment
 * @param {number} input.deadline
 * @param {number} [input.uploadTimeoutMs]
 * @param {number} [input.retryAfterMs]
 */
export const archiveAfterTurn = async ({
  retryAfterMs = NO_TURNS_RETRY_MS,
  ...input
}) => {
  const lock = join(
    input.configuration.stateDir,
    'archived',
    `${createHash('sha256').update(input.sessionId).digest('hex').slice(0, 32)}.lock`,
  )
  if (!(await takeLock(lock, input.deadline))) {
    return { archived: 0, refusals: ['busy'] }
  }
  try {
    let result = await archiveSession(input)
    if (
      result.refusals.includes('no_turns') &&
      !expired(input.deadline - retryAfterMs)
    ) {
      await sleep(retryAfterMs)
      result = await archiveSession(input)
    }
    return result
  } finally {
    await rm(lock, { force: true })
  }
}
