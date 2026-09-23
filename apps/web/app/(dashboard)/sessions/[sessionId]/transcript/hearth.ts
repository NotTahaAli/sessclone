import type { Item } from '@sessclone/shared'

import { parseEnvelope } from './envelope'
import { field } from './format'

// A session running in a Claude Project talks to people only through the
// hearthbot MCP tools: `reply` is the message they saw, `update_message`
// rewrote it later, `react`/`unreact` put emoji on it, and `update_status`
// is the checklist under the thread (Taha, 2026-09-23). This reads those
// calls out of the loaded Items so each reply renders as the message it was,
// with its edit history and its reactions. Pure, so it is tested here.

const PREFIX = 'mcp__hearthbot__'

/** `reply`, `update_status`… for a hearthbot tool, else null. */
export const hearthTool = (name: string) =>
  name.startsWith(PREFIX) ? name.slice(PREFIX.length) : null

export type Edit = { text: string; at: string | null }
export type Reaction = { emoji: string; added: boolean; at: string | null }

export type Hearth = {
  /** Project message id a `reply` call created, by its tool call id. */
  replyIds: ReadonlyMap<string, string>
  /** Later texts of a message, oldest first, by project message id. */
  edits: ReadonlyMap<string, Edit[]>
  /** Every react and unreact on a message, oldest first. */
  reactions: ReadonlyMap<string, Reaction[]>
}

export const EMPTY_HEARTH: Hearth = {
  replyIds: new Map(),
  edits: new Map(),
  reactions: new Map(),
}

const text = (value: unknown) => (typeof value === 'string' ? value : null)

const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/**
 * A call counts only once its result comes back without an error: a failed
 * edit or reaction never reached anyone, and a reply without a message id
 * has nothing to edit or react to.
 */
export function readHearth(items: readonly Item[]): Hearth {
  const pending = new Map<string, Extract<Item, { kind: 'tool_use' }>>()
  const replyIds = new Map<string, string>()
  const edits = new Map<string, Edit[]>()
  const reactions = new Map<string, Reaction[]>()
  for (const item of items) {
    if (item.kind === 'tool_use') {
      if (hearthTool(item.name)) pending.set(item.toolUseId, item)
      continue
    }
    if (item.kind !== 'tool_result') continue
    const call = pending.get(item.toolUseId)
    if (!call) continue
    pending.delete(item.toolUseId)
    if (item.isError) continue
    const tool = hearthTool(call.name)
    const id = text(field(call.input, 'message_id'))
    if (tool === 'reply') {
      try {
        const made = text(field(JSON.parse(item.text), 'message_id'))
        if (made) replyIds.set(item.toolUseId, made)
      } catch {
        // Not the JSON a reply answers with: no id, so no edits or emoji.
      }
    } else if (tool === 'update_message' && id) {
      const next = text(field(call.input, 'text'))
      if (next !== null) push(edits, id, { text: next, at: call.at })
    } else if ((tool === 'react' || tool === 'unreact') && id) {
      const emoji = text(field(call.input, 'emoji'))
      if (emoji)
        push(reactions, id, { emoji, added: tool === 'react', at: call.at })
    }
  }
  return { replyIds, edits, reactions }
}

/**
 * The emoji on a message now: each react, less each later unreact, compared
 * as emoji so `eyes` and 👀 are the same one.
 */
export const currentReactions = (history: readonly Reaction[] = []) => {
  const on = new Set<string>()
  for (const { emoji, added } of history) {
    if (added) on.add(emojiOf(emoji))
    else on.delete(emojiOf(emoji))
  }
  return [...on]
}

const SHORTCODES = new Map(
  Object.entries({
    '+1': '👍',
    thumbsup: '👍',
    '-1': '👎',
    eyes: '👀',
    tada: '🎉',
    white_check_mark: '✅',
    heart: '❤️',
    rocket: '🚀',
    pray: '🙏',
    fire: '🔥',
    x: '❌',
    warning: '⚠️',
  }),
)

/** A shortcode as its emoji when it is a common one, else `:code:`. */
export const emojiOf = (value: string) => {
  const code = value.replace(/^:|:$/g, '')
  const known = SHORTCODES.get(code)
  if (known) return known
  return /^[\w+-]+$/.test(code) ? `:${code}:` : value
}

/** The project message id of a person's wrapped message, when it has one. */
export const envelopeId = (raw: string) => {
  const envelope = parseEnvelope(raw)
  return envelope?.kind === 'wake' ? envelope.id : null
}

export type StatusLine = {
  mark: 'done' | 'doing' | 'todo' | null
  text: string
}

const unbold = (line: string) => line.replaceAll('**', '')

/** An `update_status` checklist: its header, then one line per step. */
export const parseStatus = (value: string) => {
  const [header = '', ...rest] = value.split('\n')
  const lines: StatusLine[] = rest
    .filter((line) => line.trim())
    .map((line) => {
      const bare = unbold(line).trim()
      const mark = bare[0]
      return mark === '✓' || mark === '✱' || mark === '○'
        ? {
            mark: mark === '✓' ? 'done' : mark === '✱' ? 'doing' : 'todo',
            text: bare.slice(1).trim(),
          }
        : { mark: null, text: bare }
    })
  return { header: unbold(header).trim(), lines }
}
