// Ticket 39: the on-disk queue a failed push falls to.
//
// A `Stop` push retries a few times in-hook (see `deliver` in `report.mjs`);
// when the deployment is still unreachable after that, the payload is written
// here and the next `SessionStart` in this environment drains it. That is what
// turns "the laptop was on a train" from lost Turns into late ones.
//
// The queue matters most for what has no cursor fallback. A Turn dropped by a
// failed push is re-read from its transcript by the next `Stop` or by the
// sweep, because the cursor never advanced (ticket 37) — so for Turns the queue
// only delivers sooner. A `stop_failure` or a `session_end` marker reads no
// transcript and moves no cursor (tickets 40, 38), so the queue is their only
// durability, and a queued payload must be replayed byte-for-byte: `occurredAt`
// is part of `session_events_identity_key`, so a re-send with the same bytes is
// the same row and a re-send with a fresh clock is a second one. Writing the
// whole payload verbatim is what keeps that true.
//
// Everything here fails soft. An unwritable state directory costs durability,
// not correctness: the cursor still holds, so a Turn is re-read later. The one
// thing it must never do is throw into a hook that swallows everything and
// leaves the turn looking reported.

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

/** Where queued payloads live. */
const queueDirectory = (stateDir) => join(stateDir, 'queue')

/**
 * How many payloads the queue holds before the oldest are dropped.
 *
 * A cap, because a deployment that is down for a month must not fill the disk.
 * When it is reached the oldest entries go first: they are the least likely to
 * still matter and, for Turns, the most likely to be re-read from a transcript
 * anyway. A dropped `session_event` is the real loss, and the residual gap in
 * spec §5.4 already names that this queue is best-effort, not a guarantee.
 *
 * ponytail: fixed cap; make it configurable if a real deployment ever hits it.
 */
const MAX_QUEUED = 500

/** How long a queued payload waits before it is abandoned. Past this the
 * deployment it was for is not coming back for this one, and the file is a
 * month of stale bytes. */
const QUEUE_TTL_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Counts the entries this process has written, so two queued in the same
 * millisecond still sort in the order they were written.
 *
 * The millisecond alone is not enough: `Date.now()` has millisecond
 * resolution and two `enqueue` calls in one turn routinely land inside one,
 * at which point the name's random suffix decided the order — which made the
 * drain's oldest-first guarantee a coin toss, and with it which entries the
 * 500 cap drops. That is what CI caught, intermittently, as
 * `expected [ 's-2', 's-1' ] to deeply equal [ 's-1', 's-2' ]`.
 *
 * Within a process this is exact. Two processes writing in the same
 * millisecond are still ordered arbitrarily between themselves, which is what
 * the random suffix was already doing and is as much as a filename can
 * promise.
 */
let written = 0

/**
 * A sortable, unique file name. The millisecond prefix makes a lexical sort a
 * chronological one, so the drain is oldest-first without reading any file;
 * the sequence orders entries inside one millisecond; the random suffix keeps
 * two processes' entries apart.
 */
const entryName = () =>
  `${Date.now().toString().padStart(15, '0')}-${(written++)
    .toString()
    .padStart(6, '0')}-${Math.random().toString(36).slice(2, 10)}.json`

/**
 * Writes one payload to the queue. Resolves either way.
 *
 * Temp-file-and-rename, atomic within a directory, so a hook killed mid-write
 * never leaves half a payload that later parses into a malformed request.
 *
 * @param {string} stateDir
 * @param {import('@sessclone/shared').IngestPayload} payload
 */
export const enqueue = async (stateDir, payload) => {
  const directory = queueDirectory(stateDir)
  try {
    await mkdir(directory, { recursive: true })
    const path = join(directory, entryName())
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 })
    await rename(temporary, path)
    await enforceCap(directory)
  } catch {
    // A read-only state directory: the cursor held, so Turns are re-read; a
    // session event is lost, which spec §5.4 documents as the residual.
  }
}

/** Drops the oldest entries past the cap, and any past the TTL. Best-effort. */
const enforceCap = async (directory) => {
  try {
    const names = (await queueFiles(directory)).toSorted()
    const oldest = Date.now() - QUEUE_TTL_MS
    const stale = await Promise.all(
      names.map(async (name) => {
        const { mtimeMs } = await stat(join(directory, name))
        return mtimeMs < oldest ? name : null
      }),
    )
    const expired = new Set(stale.filter((name) => name !== null))
    const live = names.filter((name) => !expired.has(name))
    const overflow = live.slice(0, Math.max(live.length - MAX_QUEUED, 0))
    await Promise.all(
      [...expired, ...overflow].map((name) =>
        unlink(join(directory, name)).catch(() => {}),
      ),
    )
  } catch {
    // Enforcement is housekeeping; failing it only leaves more files than the
    // cap for one more round.
  }
}

/** The queue's `.json` entries, ignoring in-flight `.tmp` files. */
const queueFiles = async (directory) =>
  (await readdir(directory)).filter((name) => name.endsWith('.json'))

/**
 * Re-sends queued payloads, oldest first, until one fails or the queue is
 * empty. Resolves with how many were accepted.
 *
 * Stops on the first failure rather than trying the rest: they are ordered, the
 * failure means the deployment is still unreachable, and firing the whole
 * backlog at a server that just refused one is how a Collector turns an outage
 * into a thundering herd. A payload the deployment *refuses* (a 4xx — malformed,
 * or past a limit) is dropped rather than retried forever, exactly as a live
 * report would be; only an unreachable deployment (`ok` false with no status)
 * leaves the entry in place.
 *
 * `shouldStop` is the sweep's time box: a deployment that is reachable but slow
 * can answer each entry in hundreds of milliseconds, so a large backlog would
 * otherwise run past the hook's ten seconds and be killed mid-drain. The check
 * is between entries, so the current one always finishes; whatever is left is
 * drained by the next session start.
 *
 * No lock, so two session starts at once each drain the whole queue and every
 * entry is sent twice. That is deliberately left to ingest's idempotence: a
 * `session_event` re-sent with its bytes unchanged is the same row (ADR 0006),
 * so a double drain costs a wasted request, never a wrong count — cheaper than
 * a cross-process lock in a hook that has ten seconds to live.
 *
 * @param {string} stateDir
 * @param {(payload: import('@sessclone/shared').IngestPayload) => Promise<{ ok: boolean, status: number | null }>} send
 * @param {() => boolean} [shouldStop] Checked between entries; true ends the drain.
 * @returns {Promise<{ drained: number }>}
 */
export const drainQueue = async (stateDir, send, shouldStop = () => false) => {
  const directory = queueDirectory(stateDir)
  let drained = 0

  let names
  try {
    names = (await queueFiles(directory)).toSorted()
  } catch {
    return { drained } // No queue directory yet: nothing to drain.
  }

  for (const name of names) {
    if (shouldStop()) break
    const path = join(directory, name)
    let payload
    try {
      // eslint-disable-next-line no-await-in-loop -- ordered drain, one at a time
      payload = JSON.parse(await readFile(path, 'utf8'))
    } catch {
      // Corrupt or already gone: drop it and continue.
      // eslint-disable-next-line no-await-in-loop -- see above
      await unlink(path).catch(() => {})
      continue
    }

    // eslint-disable-next-line no-await-in-loop -- deliberately sequential
    const { ok, status } = await send(payload)
    if (ok || (status !== null && status >= 400 && status < 500)) {
      // Accepted, or refused for good: either way it is done with. A refusal
      // retried unchanged only ever earns the same refusal.
      // eslint-disable-next-line no-await-in-loop -- see above
      await unlink(path).catch(() => {})
      if (ok) drained += 1
    } else {
      // Unreachable or a 5xx: the deployment is not ready. Leave this and the
      // rest for the next sweep.
      break
    }
  }

  return { drained }
}
