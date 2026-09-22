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
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { sessionTranscripts } from './transcripts.mjs'

/**
 * How long one archival request may take.
 *
 * The hook has ten seconds in total (`hooks.json`) and the sweep's budget is
 * checked between transcripts, so one slow upload must not eat the whole hook:
 * a transcript that cannot be sent in eight seconds is left for the next
 * opportunity, which costs nothing because nothing has been recorded.
 */
export const UPLOAD_TIMEOUT_MS = 8000

/** The small requests either side of the upload. */
const REQUEST_TIMEOUT_MS = 4000

/**
 * The SHA-256 of a file, lowercase hex, streamed.
 *
 * Streamed rather than read: this runs against every transcript a sweep
 * touches, and reading each one into memory to hash it is the allocation the
 * Collector spends its whole budget avoiding elsewhere.
 *
 * @param {string} path
 * @returns {Promise<string | null>} Null when the file cannot be read.
 */
export const hashFile = async (path) => {
  const digest = createHash('sha256')
  try {
    await pipeline(createReadStream(path), digest)
  } catch {
    return null
  }
  return digest.digest('hex')
}

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
 * @returns {Promise<{ ok: boolean, status: number | null, body: any }>}
 */
const ask = async ({ configuration, path, body }) => {
  try {
    const answer = await fetch(`${configuration.url}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${configuration.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
 * @returns {Promise<{ archived: boolean, refused?: string, sizeBytes?: number }>}
 */
export const archiveTranscript = async ({
  configuration,
  transcriptPath,
  sessionId,
  agentId = agentIdOf(transcriptPath),
}) => {
  const sha256 = await hashFile(transcriptPath)
  if (!sha256) return { archived: false, refused: 'unreadable' }

  const presign = await ask({
    configuration,
    path: '/api/logs/presign',
    body: { sessionId, agentId, sha256 },
  })

  // Anything that is not an issued URL — a refusal, a 401, a deployment with
  // no storage, an unreachable host — ends here without the file being opened.
  if (!presign.ok) return { archived: false, refused: 'unavailable' }
  if (presign.body?.refused) {
    return { archived: false, refused: presign.body.refused }
  }
  if (!presign.body?.url) return { archived: false, refused: 'unavailable' }

  let size
  try {
    size = (await stat(transcriptPath)).size
  } catch {
    return { archived: false, refused: 'unreadable' }
  }

  try {
    const answer = await fetch(presign.body.url, {
      method: 'PUT',
      headers: {
        // The hash was taken from the bytes on disk a moment ago; a transcript
        // that grew since is uploaded as it is now and confirmed under the old
        // hash, which the next pass corrects because the hashes then differ.
        'content-type': 'application/x-ndjson',
        'content-length': String(size),
      },
      body: Readable.toWeb(createReadStream(transcriptPath)),
      // Node requires this for a streamed request body.
      duplex: 'half',
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    })
    if (!answer.ok) return { archived: false, refused: 'upload_failed' }
  } catch {
    return { archived: false, refused: 'upload_failed' }
  }

  const confirm = await ask({
    configuration,
    path: '/api/logs/confirm',
    body: { sessionId, agentId, sha256 },
  })
  if (!confirm.ok || !confirm.body?.stored) {
    // The bytes are in the bucket and no row names them. The next pass
    // re-uploads and re-confirms, which is why the object is replaced in place
    // rather than versioned: a repeat costs the upload again and never a
    // second object.
    return { archived: false, refused: 'unconfirmed' }
  }

  return { archived: true, sizeBytes: confirm.body.sizeBytes }
}

/**
 * Archives every transcript one Session wrote: its own, and one per Agent Run.
 *
 * Sequential, and stopped by `shouldStop`, for the same reason the sweep is:
 * a Session with twenty subagent runs must not fire twenty uploads at once,
 * and the hook it runs inside has ten seconds.
 *
 * @param {object} input
 * @param {import('./configuration.mjs').CollectorConfiguration} input.configuration
 * @param {string | undefined} input.transcriptPath
 * @param {string} input.sessionId
 * @param {Record<string, string | undefined>} input.environment
 * @param {() => boolean} [input.shouldStop]
 */
export const archiveSession = async ({
  configuration,
  transcriptPath,
  sessionId,
  environment,
  shouldStop = () => false,
}) => {
  const transcripts = await sessionTranscripts({
    transcriptPath,
    sessionId,
    environment,
  })

  let archived = 0
  for (const { path } of transcripts) {
    if (shouldStop()) break
    // eslint-disable-next-line no-await-in-loop -- one upload at a time, on purpose
    const result = await archiveTranscript({
      configuration,
      transcriptPath: path,
      sessionId,
    })
    if (result.archived) archived += 1
  }
  return { archived }
}
