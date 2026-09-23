// Tickets 105 and 108: the pure half of the column view — which columns are
// open, how wide each is, and which bytes of the main transcript to fetch
// next. The component only renders what these decide.

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

/**
 * The next byte range to fetch, reading backwards from `loadedFrom` (the first
 * byte already loaded; the file size before anything is). Inclusive ends, as
 * an HTTP Range header writes them. Null once the start is loaded.
 */
export const earlierRange = (
  loadedFrom: number,
  chunk = CHUNK_BYTES,
): { start: number; end: number } | null =>
  loadedFrom <= 0
    ? null
    : { start: Math.max(0, loadedFrom - chunk), end: loadedFrom - 1 }
