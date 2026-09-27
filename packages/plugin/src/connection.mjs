// Whether this machine's key is accepted, and for which Org.
//
// `GET /api/ingest` answers the Org's name for a live key and the same 401 as
// a report for anything else. With no key configured the request goes without
// one: a Claude Code cloud environment's proxy adds the SessClone credential
// itself, so the answer says whether that credential is connected too.
//
// Only a hook can ask: Claude Code gives the setup prompt's answers to hook
// processes and to nothing Claude runs, so `/sessclone:status` cannot read the
// key. The session-start hook therefore writes what it learned to the state
// directory (never the key: its first three characters and length), and the
// status command, the Collector's own sends and `verify-collector.mjs` read it.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { authorization } from './configuration.mjs'

/** Short: this runs first inside the session-start hook's budget. */
export const CHECK_TIMEOUT_MS = 3000

const FILE = 'connection.json'

/**
 * @typedef {{ state: 'connected', org: string | null }
 *   | { state: 'refused' }
 *   | { state: 'unknown', status: number | null }} Connection
 *
 * @typedef {object} Checked What the last session start found.
 * @property {string} id Which key and deployment it was about, hashed.
 * @property {Connection['state']} state
 * @property {string | null} org
 * @property {string} url
 * @property {{ prefix: string, length: number } | null} key
 * @property {string} at
 */

/**
 * Asks the deployment about the key. Resolves either way.
 *
 * `unknown` covers a deployment that could not be reached and one too old to
 * have the route (405): neither says anything about the key, so neither is
 * reported as a key problem.
 *
 * @param {import('./configuration.mjs').CollectorConfiguration} configuration
 * @param {number} [timeoutMs]
 * @returns {Promise<Connection>}
 */
export const checkConnection = async (
  configuration,
  timeoutMs = CHECK_TIMEOUT_MS,
) => {
  try {
    const answer = await fetch(`${configuration.url}/api/ingest`, {
      headers: authorization(configuration),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (answer.status === 401) {
      await answer.body?.cancel()
      return { state: 'refused' }
    }
    if (!answer.ok) {
      await answer.body?.cancel()
      return { state: 'unknown', status: answer.status }
    }
    const body = await answer.json().catch(() => null)
    return {
      state: 'connected',
      org: typeof body?.org === 'string' ? body.org : null,
    }
  } catch {
    return { state: 'unknown', status: null }
  }
}

/**
 * Which key and deployment, as a hash: a new key or a new URL is a new
 * connection, worth announcing and not bound by an old refusal.
 *
 * @param {{ apiKey?: string, url: string }} configuration
 */
const identity = ({ apiKey, url }) =>
  createHash('sha256')
    .update(`${apiKey ?? 'proxy'}\n${url}`)
    .digest('hex')

/**
 * What the last session start found, or null.
 *
 * @param {string} stateDir
 * @returns {Promise<Checked | null>}
 */
export const readChecked = async (stateDir) => {
  try {
    return JSON.parse(await readFile(join(stateDir, FILE), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Whether the deployment refused this very key and URL at session start.
 *
 * `send` and the archive consult it before any request: a refused key would
 * otherwise re-send a session's whole unsent history, with its paths and
 * branches, on every turn to a deployment that already said no.
 *
 * @param {import('./configuration.mjs').CollectorConfiguration} configuration
 */
export const refusedHere = async (configuration) => {
  const checked = await readChecked(configuration.stateDir)
  return checked?.state === 'refused' && checked.id === identity(configuration)
}

/**
 * Records a check and returns the line to show at session start, or null.
 *
 * "Connected" once per key, deployment and Org, so it confirms an install
 * without becoming noise; "not connected" every time, because it stays true
 * until somebody acts. An `unknown` answer keeps what was known before, and
 * says nothing about the key.
 *
 * @param {import('./configuration.mjs').CollectorConfiguration} configuration
 * @param {Connection} connection
 * @param {Date} [now]
 * @returns {Promise<string | null>}
 */
export const recordConnection = async (
  configuration,
  connection,
  now = new Date(),
) => {
  if (connection.state === 'unknown') return null

  const before = await readChecked(configuration.stateDir)
  const id = identity(configuration)
  const org = connection.state === 'connected' ? connection.org : null
  const { apiKey, url, stateDir } = configuration
  /** @type {Checked} */
  const checked = {
    id,
    state: connection.state,
    org,
    url,
    key: apiKey ? { prefix: apiKey.slice(0, 3), length: apiKey.length } : null,
    at: now.toISOString(),
  }
  try {
    await mkdir(stateDir, { recursive: true })
    const temporary = join(stateDir, `${FILE}.${process.pid}.tmp`)
    await writeFile(temporary, JSON.stringify(checked), { mode: 0o600 })
    await rename(temporary, join(stateDir, FILE))
  } catch {
    // An unwritable state directory repeats the line; nothing worse.
  }

  if (connection.state === 'refused') {
    return apiKey
      ? `sessclone is not connected: ${url} refused this API key, so nothing is being collected. Create a new key under Keys, then run /plugin configure sessclone to enter it.`
      : `sessclone is not connected: no API key is set, so nothing is being collected. Create one under Keys at ${url}, then run /plugin configure sessclone to enter it.`
  }
  const same =
    before?.state === 'connected' && before.id === id && before.org === org
  if (same) return null
  return org
    ? `sessclone connected: reporting to ${org}.`
    : 'sessclone connected.'
}
