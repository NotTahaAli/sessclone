// Ticket 98: what the deployment last said, kept where a person can find it.
//
// A refused report writes no cursor and queues nothing (a 4xx is final), so
// before this a Collector whose every report was answered 401 left no trace
// at all — not even its state directory — and looked exactly like one that was
// never installed. One small file, overwritten by every report, fixes that:
// `verify-collector.mjs` prints it, and `session-start.mjs` says so when the
// last answer was a refused key.
//
// The status and the time only. Never the key, the URL's credentials or the
// body: a hook's stderr lands in the transcript this product uploads.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE = 'last-answer.json'

/**
 * @param {string} stateDir
 * @param {number | null} status `null` when the deployment was not reached.
 * @param {Date} [now]
 */
export const recordAnswer = async (stateDir, status, now = new Date()) => {
  try {
    await mkdir(stateDir, { recursive: true })
    // Renamed into place: `Stop` and an async `SessionEnd` can both write, and
    // a torn file would read as no answer at all.
    const temporary = join(stateDir, `${FILE}.${process.pid}.tmp`)
    await writeFile(
      temporary,
      JSON.stringify({ status, at: now.toISOString() }),
      { mode: 0o600 },
    )
    await rename(temporary, join(stateDir, FILE))
  } catch {
    // A read-only state directory is reported by the install check itself.
  }
}

/**
 * @param {string} stateDir
 * @returns {Promise<{ status: number | null, at: string } | null>}
 */
export const readAnswer = async (stateDir) => {
  try {
    return JSON.parse(await readFile(join(stateDir, FILE), 'utf8'))
  } catch {
    return null
  }
}

/**
 * What to tell a person about the last answer, or null when nothing is wrong.
 *
 * A 401 is the one worth interrupting a session for: it is permanent until
 * somebody changes the key or the route, and nothing else will say it.
 *
 * Only an answer from `since` on, so a key fixed since is not blamed for an
 * old refusal. A refused key never advances a cursor, so every sweep resends
 * and a live refusal is always a fresh one.
 *
 * @param {{ status: number | null, at: string } | null} answer
 * @param {Date} [since]
 */
export const refusalNotice = (answer, since = new Date(0)) =>
  answer?.status === 401 && Date.parse(answer.at) >= since.getTime()
    ? `sessclone: the deployment refused this machine's key (401) at ${answer.at}, so nothing is being collected. Check the key under Keys; in a Claude Code cloud environment, check the SessClone API credential and that the Collector goes through the proxy. See docs/install.md.`
    : null
