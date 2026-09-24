// Tickets 105 and 108: the pure half of the column view — which columns are
// open, how wide each is, and which bytes of the main transcript to fetch
// next. The component only renders what these decide.

import { splitChunk } from '@sessclone/shared'

/** One open column. `main` is the Session; the others open from a block. */
export type Column =
  | { kind: 'main'; key: 'main' }
  | { kind: 'agent'; key: string; agentId: string; title: string }
  | { kind: 'workflow'; key: string; runId: string; title: string }

export const agentColumn = (agentId: string, title: string): Column => ({
  kind: 'agent',
  key: `agent:${agentId}`,
  agentId,
  title,
})

export const workflowColumn = (runId: string, title: string): Column => ({
  kind: 'workflow',
  key: `workflow:${runId}`,
  runId,
  title,
})

/**
 * Finder's rule. A block in column `from` opens its column right after `from`,
 * closing anything deeper; the block whose column is already there closes it
 * (and anything deeper) instead.
 */
export const toggleColumn = (
  columns: Column[],
  from: number,
  next: Column,
): Column[] => {
  const kept = columns.slice(0, from + 1)
  return columns[from + 1]?.key === next.key ? kept : [...kept, next]
}

export const MIN_WIDTH = 440

/** What a reader dragged, remembered per browser. */
export type SavedWidths = { main?: number; side?: number }

/**
 * Pixel widths for a desktop row of `count` columns in `container` pixels.
 * One column fills the row (null means 100%). With more, every side column
 * is 440px (or what was dragged) and the main column takes what is left, never
 * under 440px — past that the row scrolls sideways.
 */
export const columnWidths = (
  count: number,
  container: number,
  saved: SavedWidths,
): (number | null)[] => {
  if (count <= 1) return [null]
  const side = Math.max(MIN_WIDTH, saved.side ?? MIN_WIDTH)
  const main = Math.max(MIN_WIDTH, saved.main ?? container - side * (count - 1))
  return [main, ...Array<number>(count - 1).fill(side)]
}

/** Parses what localStorage held, trusting nothing about it. */
export const readWidths = (raw: string | null): SavedWidths => {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    const width = (key: string) => {
      const n: unknown =
        value && typeof value === 'object' ? Reflect.get(value, key) : null
      return typeof n === 'number' && Number.isFinite(n) && n >= MIN_WIDTH
        ? Math.round(n)
        : undefined
    }
    const main = width('main')
    const side = width('side')
    return {
      ...(main === undefined ? {} : { main }),
      ...(side === undefined ? {} : { side }),
    }
  } catch {
    return {}
  }
}

/** How much of the main transcript one scroll-up fetches. */
export const CHUNK_BYTES = 1024 * 1024

/** One earlier piece of the main transcript, in raw offsets, ends inclusive. */
export type Read =
  | { kind: 'range'; start: number; end: number }
  /** Chunk `index`, fetched whole and kept up to `end`. */
  | { kind: 'chunk'; index: number; start: number; end: number }

/**
 * The next earlier piece to fetch before raw byte `from` (the first byte
 * already loaded; the file size before anything is), or null at byte 0.
 *
 * ADR 0008: past `tailOffset` it is a Range read inside the tail object, a
 * chunk at most and clamped at the tail's start. Before it, the sealed chunk
 * holding `from - 1`, read whole because a gzip stream cannot be Range-read.
 * With zero chunks this is the backwards range walk tickets 105 and 108 read.
 */
export const earlierRead = (
  file: {
    tailOffset: number
    chunks: readonly { rawOffset: number; rawLength: number }[]
  },
  from: number,
  size = CHUNK_BYTES,
): Read | null => {
  if (from <= 0) return null
  if (from > file.tailOffset) {
    return {
      kind: 'range',
      start: Math.max(file.tailOffset, from - size),
      end: from - 1,
    }
  }
  const index = file.chunks.findIndex(
    (chunk) =>
      chunk.rawOffset < from && from <= chunk.rawOffset + chunk.rawLength,
  )
  const chunk = file.chunks[index]
  return chunk
    ? { kind: 'chunk', index, start: chunk.rawOffset, end: from - 1 }
    : null
}

/** Room at the top that counts as "near the start" and triggers a load. */
export const NEAR_TOP = 600

/**
 * Whether the main column should fetch the next earlier chunk without being
 * scrolled: there is more before `from`, and either nothing has parsed yet —
 * a last line longer than a chunk yields no whole line, and an empty column
 * has nothing to scroll — or what has does not fill the view.
 */
export const keepReading = ({
  from,
  items,
  scrollHeight,
  clientHeight,
}: {
  from: number
  items: number
  scrollHeight: number
  clientHeight: number
}) => from > 0 && (items === 0 || scrollHeight <= clientHeight + NEAR_TOP)

/**
 * One chunk of the main transcript, read backwards, cut into whole lines.
 *
 * The file's end is never taken as the end of a line: the transcript may be
 * live, and a last line without its newline is one still being written. That
 * fragment is dropped (it is `tail`) rather than parsed as a broken entry; the
 * next Reload reads it whole.
 */
export const splitEarlier = (bytes: Uint8Array, start: number) =>
  splitChunk(bytes, start, { atFileStart: start === 0, atFileEnd: false })
