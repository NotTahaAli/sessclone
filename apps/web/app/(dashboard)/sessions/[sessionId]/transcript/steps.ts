import type { Row } from '@sessclone/shared'

import { field } from './format'

// The chat view (Taha, 2026-09-23, style C): what Claude did between two
// messages folds into one "Thought, 3 tools" line, the way Claude Code shows
// it. Messages, subagent and workflow cards, artifacts, and anything that
// interrupts the flow (an error, a compaction) stay rows of their own.
// Pure, so the grouping is tested here rather than eyeballed.

export type StepGroup = {
  kind: 'steps'
  rows: Row[]
  /** First step's start. */
  startAt: string | null
  /** Last step's end: a tool's result, a hook's finish, else its own time. */
  endAt: string | null
}

export type Display = Row | StepGroup

/** A tool call that renders as a card, not a step: an artifact publish. */
export const isArtifact = (row: Row) =>
  row.kind === 'tool' &&
  row.use.name === 'Artifact' &&
  typeof field(row.use.input, 'file_path') === 'string'

const STEP_ITEMS = new Set([
  'thinking',
  'hook',
  'injected',
  'attachment',
  'queue',
  'tool_result',
  'unknown',
])

const isStep = (row: Row) =>
  row.kind === 'skill' ||
  (row.kind === 'tool' && !isArtifact(row)) ||
  (row.kind === 'item' && STEP_ITEMS.has(row.item.kind))

const startOf = (row: Row): string | null =>
  row.kind === 'item' ? row.item.at : row.kind === 'section' ? null : row.use.at

const endOf = (row: Row): string | null => {
  if (row.kind === 'tool' || row.kind === 'skill')
    return row.result?.at ?? row.use.at
  if (row.kind === 'item' && row.item.kind === 'hook') {
    const { at, durationMs } = row.item
    if (at && durationMs !== null) {
      const end = Date.parse(at) + durationMs
      if (!Number.isNaN(end)) return new Date(end).toISOString()
    }
  }
  return startOf(row)
}

const later = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : Date.parse(b) > Date.parse(a) ? b : a

export function groupSteps(rows: Row[]): Display[] {
  const out: Display[] = []
  let run: Row[] = []
  const flush = () => {
    if (run.length === 1) out.push(run[0]!)
    else if (run.length > 1) {
      out.push({
        kind: 'steps',
        rows: run,
        startAt: run.map(startOf).find(Boolean) ?? null,
        endAt: run.map(endOf).reduce(later, null),
      })
    }
    run = []
  }
  for (const row of rows) {
    if (isStep(row)) run.push(row)
    else {
      flush()
      out.push(row)
    }
  }
  flush()
  return out
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** "Thought, 3 tools, 1 hook": what a group holds, in a few words. */
export const stepsLabel = (rows: Row[]) => {
  let thought = false
  let tools = 0
  let hooks = 0
  let other = 0
  for (const row of rows) {
    if (row.kind === 'tool' || row.kind === 'skill') tools++
    else if (row.kind === 'item' && row.item.kind === 'thinking') thought = true
    else if (row.kind === 'item' && row.item.kind === 'hook') hooks++
    else other++
  }
  return (
    [
      thought ? 'Thought' : null,
      tools ? plural(tools, 'tool') : null,
      hooks ? plural(hooks, 'hook') : null,
      other ? plural(other, 'note') : null,
    ]
      .filter(Boolean)
      .join(', ') || plural(rows.length, 'step')
  )
}
