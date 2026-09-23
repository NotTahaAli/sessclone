// Ticket 103: loaded Items -> Rows for one column, an agent run's summary,
// and which Rows a filter preset shows. Pure; re-run over everything loaded
// whenever another chunk arrives (see types.ts).

import { obj, usageOf } from './parse.ts'
import type { Category, Item, Preset, Row, RunStatus, Usage } from './types.ts'

type Of<K extends Item['kind']> = Extract<Item, { kind: K }>

const byOffset = (items: Item[]) =>
  // toSorted is stable, so Items of one line keep their order.
  items.toSorted((a, b) => a.offset - b.offset)

const field = (v: unknown, key: string): unknown => obj(v)[key]
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

const ms = (from: string | null, to: string | null): number | null => {
  if (!from || !to) return null
  const d = Date.parse(to) - Date.parse(from)
  return Number.isNaN(d) ? null : d
}

const maxUsage = (a: Usage | null, b: Usage | null): Usage | null =>
  !a || !b
    ? (a ?? b)
    : {
        inputTokens: Math.max(a.inputTokens, b.inputTokens),
        outputTokens: Math.max(a.outputTokens, b.outputTokens),
        cacheReadInputTokens: Math.max(
          a.cacheReadInputTokens,
          b.cacheReadInputTokens,
        ),
        cacheCreationInputTokens: Math.max(
          a.cacheCreationInputTokens,
          b.cacheCreationInputTokens,
        ),
      }

const isModelItem = (i: Item): i is Of<'assistant' | 'thinking' | 'tool_use'> =>
  i.kind === 'assistant' || i.kind === 'thinking' || i.kind === 'tool_use'

export function buildTimeline(loaded: Item[]): Row[] {
  const items = byOffset(loaded)

  // One pass to index what pairing needs, so the second pass is O(n).
  const results = new Map<string, Of<'tool_result'>>()
  const uses = new Set<string>()
  const hooks = new Map<string, Of<'hook'>[]>()
  const injectedFor = new Map<string, Of<'injected'>>()
  // Claude Code writes each content block of a response as its own line and
  // repeats usage on each; streaming blocks under-report, so take the max.
  const usage = new Map<string, Usage | null>()
  for (const i of items) {
    if (i.kind === 'tool_result') results.set(i.toolUseId, i)
    else if (i.kind === 'tool_use') uses.add(i.toolUseId)
    else if (i.kind === 'injected') {
      const source = str(field(i.raw, 'sourceToolUseID'))
      if (source) injectedFor.set(source, i)
    }
    if (isModelItem(i) && i.messageId)
      usage.set(
        i.messageId,
        maxUsage(usage.get(i.messageId) ?? null, usageOf(i.raw)),
      )
  }
  for (const i of items)
    if (i.kind === 'hook' && i.toolUseId && uses.has(i.toolUseId))
      hooks.set(i.toolUseId, [...(hooks.get(i.toolUseId) ?? []), i])

  const rows: Row[] = []
  let section: string | null = null
  const consumed = new Set<Item>()

  for (const i of items) {
    if (consumed.has(i)) continue
    if (isModelItem(i)) {
      const key = `${i.model}\u0000${i.effort}`
      if (key !== section) {
        const rule: Row = { kind: 'section', model: i.model, effort: i.effort }
        // The first rule goes at the very top of the column.
        if (section === null) rows.unshift(rule)
        else rows.push(rule)
        section = key
      }
    }
    switch (i.kind) {
      case 'tool_use': {
        const result = results.get(i.toolUseId) ?? null
        if (result) consumed.add(result)
        const detail = result?.detail
        const input = i.input
        if (i.name === 'Skill') {
          const content = injectedFor.get(i.toolUseId) ?? null
          if (content) consumed.add(content)
          rows.push({
            kind: 'skill',
            use: i,
            skill: str(field(input, 'skill')) ?? '',
            result,
            content,
          })
        } else if (i.name === 'Agent' || i.name === 'Task') {
          rows.push({
            kind: 'agent',
            use: i,
            result,
            agentId:
              str(field(detail, 'agentId')) ??
              /agentId: (\w+)/.exec(result?.text ?? '')?.[1] ??
              null,
            agentType: str(field(input, 'subagent_type')),
            description:
              str(field(input, 'description')) ??
              str(field(detail, 'description')),
            prompt: str(field(input, 'prompt')) ?? str(field(detail, 'prompt')),
            model:
              str(field(detail, 'resolvedModel')) ?? str(field(input, 'model')),
          })
        } else if (i.name === 'Workflow') {
          rows.push({
            kind: 'workflow',
            use: i,
            result,
            runId: str(field(detail, 'runId')),
            name: str(field(detail, 'workflowName')),
            summary: str(field(detail, 'summary')),
          })
        } else {
          const around = hooks.get(i.toolUseId) ?? []
          for (const h of around) consumed.add(h)
          rows.push({
            kind: 'tool',
            use: i,
            result,
            durationMs: result ? ms(i.at, result.at) : null,
            hooks: around,
          })
        }
        break
      }
      case 'assistant':
        rows.push({
          kind: 'item',
          item: i.messageId
            ? { ...i, usage: usage.get(i.messageId) ?? i.usage }
            : i,
        })
        break
      default:
        // Includes a tool_result whose call is not loaded (yet).
        rows.push({ kind: 'item', item: i })
    }
  }
  return rows
}

export type RunSummary = {
  status: RunStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  toolCount: number
  model: string | null
  effort: string | null
}

const FINAL_STOPS = new Set([
  'end_turn',
  'stop_sequence',
  'max_tokens',
  'refusal',
])
const CONVERSATION = new Set<Item['kind']>([
  'user',
  'assistant',
  'thinking',
  'tool_use',
  'tool_result',
  'injected',
  'interrupt',
  'api_error',
])

/**
 * Status of an agent run from its own file.
 *
 * The rule, from the last conversational Item (hooks, attachments and
 * bookkeeping lines ignored):
 * - no Items -> not_stored
 * - a tool_use with no loaded result anywhere -> running (a tool is running)
 * - last is user-side (user, tool_result, injected) -> running (awaiting model)
 * - last is interrupt -> done; api_error -> died_mid_turn
 * - last is a model line with a final stop_reason, or model text -> done
 * - otherwise (thinking or a partial block, stop_reason null) -> died_mid_turn
 *
 * The last two are a guess: Claude Code writes each block as it streams, so a
 * live run mid-response looks the same. Finished subagents are often left with
 * stop_reason null, which is why ending on text counts as done. Pass
 * `returned` when the parent's result or the workflow journal says the run
 * returned; that overrides to done.
 */
export function summarizeRun(
  loaded: Item[],
  opts: { returned?: boolean } = {},
): RunSummary {
  const items = byOffset(loaded)
  const times = items.flatMap((i) => (i.at ? [i.at] : []))
  const startedAt = times[0] ?? null
  const endedAt = times.at(-1) ?? null
  const model = items.findLast(isModelItem)
  const uses = items.filter((i) => i.kind === 'tool_use')
  const answered = new Set(
    items.flatMap((i) => (i.kind === 'tool_result' ? [i.toolUseId] : [])),
  )
  const last = items.findLast((i) => CONVERSATION.has(i.kind))

  let status: RunStatus
  if (items.length === 0) status = 'not_stored'
  else if (opts.returned) status = 'done'
  else if (uses.some((u) => !answered.has(u.toolUseId))) status = 'running'
  else if (!last || !isModelItem(last))
    status =
      last?.kind === 'interrupt'
        ? 'done'
        : last?.kind === 'api_error'
          ? 'died_mid_turn'
          : 'running'
  else {
    const stop = str(field(field(last.raw, 'message'), 'stop_reason'))
    // A run that ends on text finished: real subagents, background ones
    // especially, are left with stop_reason null. Ending on thinking or a
    // partial block is the stream dying.
    status =
      (stop && FINAL_STOPS.has(stop)) || last.kind === 'assistant'
        ? 'done'
        : 'died_mid_turn'
  }

  return {
    status,
    startedAt,
    endedAt,
    durationMs: ms(startedAt, endedAt),
    toolCount: uses.length,
    model: model?.model ?? null,
    effort: model?.effort ?? null,
  }
}

export function categoryOf(row: Row): Category | 'thinking' {
  if (row.kind !== 'item') return row.kind
  const { item } = row
  if (item.kind === 'hook') return item.failed ? 'hook_failed' : 'hook'
  // A tool_result shown alone (its call not loaded) or a lone tool_use.
  if (item.kind === 'tool_result' || item.kind === 'tool_use') return 'tool'
  return item.kind
}

/**
 * Rows a preset shows. Thinking is kept unless the mode is `hidden` — the
 * renderer collapses it. Tool output is not a row of its own: callers render
 * a tool row's result only when `showToolOutput` is set.
 */
export function visibleRows(
  rows: Row[],
  preset: Preset,
): { rows: Row[]; showToolOutput: boolean } {
  const on = new Set<string>(preset.categories)
  return {
    rows: rows.filter((row) => {
      const c = categoryOf(row)
      if (c === 'thinking') return preset.thinking !== 'hidden'
      return on.has(c) || (c === 'hook_failed' && on.has('hook'))
    }),
    showToolOutput: on.has('tool_output'),
  }
}
