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
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

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
 * The payloads for one finished transcript. Empty when there is nothing to
 * report.
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
 * @returns {Promise<import('@sessclone/shared').IngestPayload[]>}
 */
export const buildPayloads = async ({
  transcriptPath,
  sessionId,
  cwd,
  environment,
}) => {
  const text = await readFile(transcriptPath, 'utf8')

  const turns = parseTranscript(text)
  // The main Session only, until ticket 35: a subagent writes its own file,
  // and reporting its turns from here would file them under the wrong
  // transcript.
  const own = turns.filter(
    (turn) => turn.agentId === null && turn.sessionId === sessionId,
  )
  if (own.length === 0) return []

  // The whole file was read, so the position is the whole file — measured off
  // the text that was parsed rather than off a `stat` that races the read:
  // Claude Code appends the next entry the moment the turn ends, and a
  // `size` larger than what was parsed would acknowledge Turns nobody sent.
  // Ticket 37 is where this becomes a position to resume from rather than a
  // fact about a file that was read end to end.
  const byteOffset = Buffer.byteLength(text)
  const last = own.at(-1)

  const reports = []
  for (const { project, turns: theirs } of await byProject(
    own,
    cwd,
    environment,
  )) {
    for (let at = 0; at < theirs.length; at += TURNS_PER_REPORT) {
      const slice = theirs.slice(at, at + TURNS_PER_REPORT)
      reports.push({
        sessionId,
        agentId: null,
        project: { key: project.key, remote: project.remote },
        cursor: {
          messageId: slice.at(-1).messageId,
          // Only the report carrying the file's last Turn has read to the end
          // of the file. Every other one acknowledges no position at all
          // rather than a position it cannot know, so a cursor can never
          // advance past Turns that were refused.
          byteOffset: slice.includes(last) ? byteOffset : 0,
        },
        turns: slice,
      })
    }
  }

  const device = { key: deviceKey({ hostname: hostname(), environment }) }
  const payloads = []
  for (let at = 0; at < reports.length; at += REPORTS_PER_PAYLOAD) {
    payloads.push({
      device,
      reports: reports.slice(at, at + REPORTS_PER_PAYLOAD),
    })
  }
  return payloads
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
