// Ticket 33: what the Stop hook does, with the throwaway probe gone.
//
// One finished turn, read from the transcript Claude Code names in the hook
// event, parsed by `packages/shared`, and reported to `/api/ingest` as this
// Device. Everything that decides an identity or a counter lives in `shared`
// (ADR 0001: the plugin is orchestration), so this file is the plumbing
// between a hook event and a request and nothing else.
//
// Plain `.mjs`, for the reason `configuration.mjs` gives: the hooks are run as
// `node <file>` with no bundler, so anything they import has to run as it is.
// The two modules from `shared` this needs are pure TypeScript with no imports
// of their own, which Node ≥22.18 executes directly by stripping the types —
// `session-start.mjs` says so at session start rather than letting a report
// fail silently at midnight.
//
// What this deliberately does not do yet: keep a cursor (ticket 37), report
// subagent runs (35, 36), or queue a failed report for retry (39). Until 37
// lands, a report carries the whole transcript every time and ingest absorbs
// the repeats — the identity index makes a re-report store nothing (ADR
// 0006), which is exactly the property a cursor is an optimisation over.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

import { parseTranscript } from '../../shared/src/turns.ts'
import { deviceKey, projectKey } from '../../shared/src/identity.ts'

const run = promisify(execFile)

/** Long enough for a cold `git` on a large repository, short enough to stop. */
const GIT_TIMEOUT_MS = 2000

/** The hook has ten seconds in total; the request gets most of them. */
const REQUEST_TIMEOUT_MS = 8000

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
 * @returns {Promise<string | null>}
 */
export const originRemote = async (cwd) => {
  if (!cwd) return null

  try {
    const { stdout } = await run(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true },
    )
    const remote = stdout.trim()
    return remote === '' ? null : remote
  } catch {
    return null
  }
}

/**
 * The payload for one finished transcript, or null when there is nothing to
 * report.
 *
 * Null rather than an empty payload: a transcript whose turns all lack a
 * message id — a session that ended before the first response — would
 * otherwise be a request that the route refuses for carrying no cursor.
 *
 * @param {object} input
 * @param {string} input.transcriptPath
 * @param {string} input.sessionId
 * @param {string | undefined} input.cwd
 * @param {string | undefined} input.device `SESSCLONE_DEVICE`, when set.
 * @param {Record<string, string | undefined>} input.environment
 * @returns {Promise<import('@sessclone/shared').IngestPayload | null>}
 */
export const buildPayload = async ({
  transcriptPath,
  sessionId,
  cwd,
  environment,
}) => {
  const [text, file] = await Promise.all([
    readFile(transcriptPath, 'utf8'),
    stat(transcriptPath),
  ])

  const turns = parseTranscript(text)
  // The main Session only, until ticket 35: a subagent writes its own file,
  // and reporting its turns from here would file them under the wrong
  // transcript.
  const own = turns.filter(
    (turn) => turn.agentId === null && turn.sessionId === sessionId,
  )
  if (own.length === 0) return null

  const last = own.at(-1)
  const project = projectKey({
    // The entry's own `cwd` when it has one: a session that changed directory
    // reported where it actually ran, and the hook's event says where it
    // started.
    cwd: last?.cwd ?? cwd ?? process.cwd(),
    hostname: hostname(),
    remote: await originRemote(last?.cwd ?? cwd),
  })

  return {
    device: { key: deviceKey({ hostname: hostname(), environment }) },
    reports: [
      {
        sessionId,
        agentId: null,
        project: { key: project.key, remote: project.remote },
        // The byte offset is the whole file, because the whole file was read.
        // Ticket 37 is where this becomes a position to resume from rather
        // than a fact about a file that was read end to end.
        cursor: { messageId: last.messageId, byteOffset: file.size },
        turns: own,
      },
    ],
  }
}

/**
 * Reports one finished transcript. Resolves either way.
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
