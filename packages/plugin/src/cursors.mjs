// Ticket 37: where the Collector remembers what it has already reported.
//
// One cursor per transcript file, not per Session. Finding 74 measured a
// subagent's first line predating its parent's last by about a second, so
// there is no single append order across a Session's files and a cursor that
// assumed one would skip Turns.
//
// A cursor is a cache, never a record: losing one costs bandwidth, because the
// next report carries the whole file again and ADR 0006's identity index
// stores nothing for the repeats. So every failure here — an unwritable
// directory, a truncated file, JSON that does not parse — resolves to "no
// cursor" and a full re-report, and never to a Turn that is not sent.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The file holding one transcript's cursor.
 *
 * Named by a hash of the transcript's path rather than by the path itself: a
 * transcript path contains directory separators and, on a Member's laptop,
 * their own name — this is a filename, not a record of where anybody works.
 *
 * @param {string} stateDir
 * @param {string} transcriptPath
 */
const cursorPath = (stateDir, transcriptPath) =>
  join(
    stateDir,
    'cursors',
    `${createHash('sha256').update(transcriptPath).digest('hex').slice(0, 32)}.json`,
  )

/**
 * What was last acknowledged for this transcript, or null.
 *
 * Null covers every failure: absent, unreadable, not JSON, or JSON of the
 * wrong shape. A cursor that cannot be trusted is one that is not used.
 *
 * @param {string} stateDir
 * @param {string} transcriptPath
 * @returns {Promise<{ messageId: string, byteOffset: number } | null>}
 */
export const readCursor = async (stateDir, transcriptPath) => {
  try {
    const stored = JSON.parse(
      await readFile(cursorPath(stateDir, transcriptPath), 'utf8'),
    )
    return typeof stored?.messageId === 'string' &&
      Number.isInteger(stored?.byteOffset) &&
      stored.byteOffset >= 0
      ? { messageId: stored.messageId, byteOffset: stored.byteOffset }
      : null
  } catch {
    return null
  }
}

/**
 * Records what the deployment acknowledged. Resolves either way.
 *
 * Written to a temporary file and renamed, which is atomic within a directory:
 * a hook killed mid-write would otherwise leave half a cursor behind, and half
 * a cursor that happened to parse is the one failure this file cannot make
 * safe by re-reporting.
 *
 * @param {string} stateDir
 * @param {string} transcriptPath
 * @param {{ messageId: string, byteOffset: number }} cursor
 */
export const writeCursor = async (stateDir, transcriptPath, cursor) => {
  const path = cursorPath(stateDir, transcriptPath)
  try {
    await mkdir(join(stateDir, 'cursors'), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(cursor), { mode: 0o600 })
    await rename(temporary, path)
  } catch {
    // A read-only state directory costs bandwidth, not data: the next report
    // starts from the top of the file again.
  }
}
