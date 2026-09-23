// Ticket 100: one JSONL line -> zero or more Items, plus the two sidecars a
// workflow or agent run leaves beside its transcript.
//
// Tolerant by contract (see types.ts): nothing here throws. A line that does
// not parse, or whose shape is unfamiliar, becomes an `unknown` Item.
//
// Shapes are read from Claude Code 2.1.269-2.1.280 transcripts. One assumption
// has no real sample in this repo: an API error is an assistant line carrying
// `isApiErrorMessage: true` with its message as a text block.

import type { Line } from './chunk.ts'
import type { AgentMeta, Item, JournalAgent, Usage } from './types.ts'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
export const obj = (v: unknown): Obj => (isObj(v) ? v : {})

const tryJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Text of a string or an array of `{type:'text', text}` blocks. */
export const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => (typeof b === 'string' ? b : (str(obj(b).text) ?? '')))
    .filter((t) => t !== '')
    .join('\n')
}

export const usageOf = (raw: unknown): Usage | null => {
  const u = obj(obj(obj(raw).message).usage)
  if (Object.keys(u).length === 0) return null
  return {
    inputTokens: num(u.input_tokens) ?? 0,
    outputTokens: num(u.output_tokens) ?? 0,
    cacheReadInputTokens: num(u.cache_read_input_tokens) ?? 0,
    cacheCreationInputTokens: num(u.cache_creation_input_tokens) ?? 0,
  }
}

// Omit must distribute over the union, or the `kind` discriminant is lost.
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type Draft = DistOmit<Item, 'id' | 'offset' | 'at' | 'raw'>

const INTERRUPT = /^\[Request interrupted by user/
const COMMAND = /<command-name>([\s\S]*?)<\/command-name>/
const ARGS = /<command-args>([\s\S]*?)<\/command-args>/

function userText(line: Obj, text: string): Draft {
  if (INTERRUPT.test(text)) return { kind: 'interrupt', text }
  const command = COMMAND.exec(text)
  if (command)
    return {
      kind: 'slash_command',
      name: command[1]!.trim(),
      args: ARGS.exec(text)?.[1]?.trim() ?? '',
    }
  if (
    line.isMeta === true ||
    line.isCompactSummary === true ||
    text.startsWith('<local-command-') ||
    text.startsWith('<task-notification>')
  )
    return { kind: 'injected', text }
  return { kind: 'user', text }
}

function drafts(line: Obj): Draft[] {
  const message = obj(line.message)
  const content = message.content
  switch (line.type) {
    case 'user': {
      if (!Array.isArray(content)) return [userText(line, textOf(content))]
      const out: Draft[] = []
      const texts: string[] = []
      for (const block of content) {
        const b = obj(block)
        if (b.type === 'tool_result')
          out.push({
            kind: 'tool_result',
            toolUseId: str(b.tool_use_id) ?? '',
            isError: b.is_error === true,
            text: textOf(b.content),
            detail: line.toolUseResult ?? null,
          })
        else if (b.type === 'text') texts.push(str(b.text) ?? '')
        else if (b.type === 'image') texts.push('[image]')
      }
      if (texts.length > 0) out.unshift(userText(line, texts.join('\n')))
      return out
    }
    case 'assistant': {
      if (line.isApiErrorMessage === true)
        return [{ kind: 'api_error', text: textOf(content) }]
      const common = {
        messageId: str(message.id),
        model: str(message.model),
        effort: str(line.perTurnEffort) ?? str(line.effort),
      }
      const blocks = Array.isArray(content) ? content : [content]
      return blocks.map((block): Draft => {
        const b = obj(block)
        if (b.type === 'text')
          return {
            kind: 'assistant',
            text: str(b.text) ?? '',
            ...common,
            requestId: str(line.requestId),
            usage: usageOf(line),
            stopReason: str(message.stop_reason),
          }
        if (b.type === 'thinking' || b.type === 'redacted_thinking')
          return { kind: 'thinking', text: str(b.thinking) ?? '', ...common }
        if (b.type === 'tool_use')
          return {
            kind: 'tool_use',
            toolUseId: str(b.id) ?? '',
            name: str(b.name) ?? '',
            input: b.input ?? null,
            ...common,
          }
        return { kind: 'unknown', type: `assistant:${str(b.type)}` }
      })
    }
    case 'attachment': {
      const a = obj(line.attachment)
      const type = str(a.type) ?? ''
      if (type.startsWith('hook_')) {
        const exitCode = num(a.exitCode)
        return [
          {
            kind: 'hook',
            event: str(a.hookEvent) ?? '',
            name: str(a.hookName),
            command: str(a.command),
            exitCode,
            durationMs: num(a.durationMs),
            // hook_error_*, hook_non_blocking_error, hook_blocking_error,
            // hook_cancelled, or any hook that exited non-zero.
            failed:
              /error|block|cancel/.test(type) ||
              (exitCode !== null && exitCode !== 0),
            output: [a.stdout, a.stderr, a.content]
              .map(textOf)
              .filter((t) => t !== '')
              .join('\n'),
            toolUseId: str(a.toolUseID),
          },
        ]
      }
      return [
        {
          kind: 'attachment',
          attachmentType: type,
          text: textOf(a.text ?? a.content ?? a.prompt),
        },
      ]
    }
    case 'system':
      if (line.subtype === 'compact_boundary') {
        const m = obj(line.compactMetadata)
        return [
          {
            kind: 'compaction',
            trigger: str(m.trigger),
            preTokens: num(m.preTokens),
          },
        ]
      }
      return [{ kind: 'unknown', type: `system:${str(line.subtype)}` }]
    case 'queue-operation':
      return [
        {
          kind: 'queue',
          operation: str(line.operation) ?? '',
          text: textOf(line.content),
        },
      ]
    default:
      return [{ kind: 'unknown', type: str(line.type) }]
  }
}

export function parseLines(lines: Line[]): Item[] {
  const items: Item[] = []
  for (const { text, offset } of lines) {
    const line = tryJson(text)
    if (!isObj(line)) {
      items.push({
        kind: 'unknown',
        type: null,
        id: `@${offset}`,
        offset,
        at: null,
        raw: text,
      })
      continue
    }
    const base = str(line.uuid) ?? `@${offset}`
    const at = str(line.timestamp)
    let out: Draft[]
    try {
      out = drafts(line)
    } catch {
      out = [{ kind: 'unknown', type: str(line.type) }]
    }
    if (out.length === 0) out = [{ kind: 'unknown', type: str(line.type) }]
    out.forEach((d, n) =>
      items.push({
        ...d,
        id: out.length > 1 ? `${base}:${n}` : base,
        offset,
        at,
        raw: line,
      }),
    )
  }
  return items
}

/** A workflow's `journal.jsonl`: one entry per started agent, in start order. */
export function parseJournal(text: string): JournalAgent[] {
  const agents = new Map<string, JournalAgent>()
  for (const raw of text.split('\n')) {
    const line = obj(tryJson(raw))
    const agentId = str(line.agentId)
    if (!agentId) continue
    if (line.type === 'started')
      agents.set(agentId, {
        agentId,
        label: str(line.label),
        phase: str(line.phase),
        done: agents.get(agentId)?.done ?? false,
      })
    else if (line.type === 'result') {
      const agent = agents.get(agentId)
      if (agent) agent.done = true
    }
  }
  return [...agents.values()]
}

/** An agent's `.meta.json` sidecar. */
export function parseMeta(text: string): AgentMeta {
  const m = obj(tryJson(text))
  return {
    agentType: str(m.agentType),
    description: str(m.description),
    toolUseId: str(m.toolUseId),
    spawnDepth: num(m.spawnDepth),
    workflowPhase: str(m.workflowPhase),
    model: str(m.model),
  }
}
