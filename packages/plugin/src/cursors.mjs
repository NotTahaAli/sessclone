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
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
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
 * How long a cursor outlives the transcript it points into.
 *
 * Claude Code deletes a transcript once it is older than its own retention
 * window, which defaults to 30 days — and a cursor is named by a hash of the
 * path, so nothing here can ask whether that file still exists. Without this
 * the directory grows by one file per Session *and per Agent Run* forever
 * (finding 06 measured 149 runs in one project). A cursor this old is also
 * useless: the transcript it belongs to is gone.
 */
const CURSOR_TTL_MS = 45 * 24 * 60 * 60 * 1000

/** One in this many writes pays for the sweep, which is a directory listing. */
const SWEEP_ODDS = 50

/**
 * Drops cursors, and abandoned temporary files, older than the window above.
 *
 * Occasional rather than every write: the cost is a `readdir` plus a `stat`
 * per entry, and nothing here is urgent — the directory has to be a year of
 * Sessions before it is even large.
 *
 * @param {string} directory
 */
const sweep = async (directory) => {
  if (Math.random() * SWEEP_ODDS >= 1) return
  const oldest = Date.now() - CURSOR_TTL_MS
  try {
    const names = await readdir(directory)
    await Promise.all(
      names.map(async (name) => {
        const path = join(directory, name)
        const { mtimeMs } = await stat(path)
        if (mtimeMs < oldest) await unlink(path)
      }),
    )
  } catch {
    // A cursor that outlives its transcript costs a few hundred bytes of disk.
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
    await sweep(join(stateDir, 'cursors'))
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(cursor), { mode: 0o600 })
    await rename(temporary, path)
  } catch {
    // A read-only state directory costs bandwidth, not data: the next report
    // starts from the top of the file again.
  }
}
