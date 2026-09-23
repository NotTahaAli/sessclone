import type { RunStatus } from '@sessclone/shared'

// Tickets 105-108: how the viewer says a time, a duration and a tool call in a
// few characters. Pure, so the phrasing is tested once here rather than
// eyeballed in a browser.

/** `14:03:27`, in the Org's timezone like every other time on the dashboard. */
export const clockFormat = (timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: timezone,
  })

/** `850ms`, `12.3s`, `4m 05s`, `1h 02m`. */
export const duration = (ms: number) => {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** `+4m 05s` from the session's first timestamp, or null when either is missing. */
export const offset = (at: string | null, start: string | null) => {
  if (!at || !start) return null
  const ms = Date.parse(at) - Date.parse(start)
  return Number.isNaN(ms) ? null : `+${duration(ms)}`
}

/**
 * `value.a.b.c`, for a shape nobody promised: undefined wherever a step is
 * missing or is not an object. Transcript lines are Claude Code's internal
 * format, so nothing read from one is trusted to have a shape.
 */
export const field = (value: unknown, ...path: string[]): unknown => {
  let at = value
  for (const key of path) {
    if (!at || typeof at !== 'object') return undefined
    at = Reflect.get(at, key)
  }
  return at
}

const SUMMARY_LIMIT = 120

const clip = (text: string) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > SUMMARY_LIMIT
    ? `${line.slice(0, SUMMARY_LIMIT - 1)}…`
    : line
}

/**
 * One line saying what a tool call did: Bash's description (or its command),
 * the file for the file tools, the pattern for the search tools, and otherwise
 * the first string input it was given.
 */
export const toolSummary = (name: string, input: unknown) => {
  if (!input || typeof input !== 'object') return ''
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = field(input, key)
      if (typeof value === 'string' && value.trim()) return clip(value)
    }
    return null
  }
  const named =
    name === 'Bash'
      ? pick('description', 'command')
      : ['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)
        ? pick('file_path', 'notebook_path')
        : ['Grep', 'Glob'].includes(name)
          ? pick('pattern')
          : // A hearthbot call names a message id first; what changed is more use.
            name.startsWith('mcp__hearthbot__')
            ? pick('emoji', 'text', 'reason')
            : null
  if (named) return named
  const first = Object.values(input).find(
    (value): value is string => typeof value === 'string' && !!value.trim(),
  )
  return first ? clip(first) : ''
}

/** `mcp__hearthbot__react` reads as `hearthbot · react`; other names as they are. */
export const toolName = (name: string) => {
  const [prefix, server, ...tool] = name.split('__')
  return prefix === 'mcp' && server && tool.length
    ? `${server} · ${tool.join('__')}`
    : name
}

/** `claude-opus-5-5 · high`; the plain model id, which never goes stale. */
export const sectionLabel = (model: string | null, effort: string | null) =>
  [model ?? 'model not reported', effort].filter(Boolean).join(' · ')

export const STATUS_LABEL: Record<RunStatus, string> = {
  done: 'done',
  running: 'running',
  died_mid_turn: 'died mid-turn',
  not_stored: 'transcript not stored',
}

/** Pretty JSON for a details view, which never throws on a cycle or a BigInt. */
export const json = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
