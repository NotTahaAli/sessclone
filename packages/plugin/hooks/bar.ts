// The status bar's words, colour and link, apart from the mod so they are
// tested without a session (`bar.test.mjs`).

import type { Standing } from '../types'

/** Claude Code gives a hook these; the mod hands them on to the scripts. */
export const optionEnvironment = (
  options: Readonly<Record<string, unknown>>,
) => {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(options)) {
    if (typeof value === 'string' && value.trim()) {
      env[`CLAUDE_PLUGIN_OPTION_${name.toUpperCase()}`] = value
    }
  }
  return env
}

/** The dashboard page for a session, where the surface can draw the link. */
export const sessionLink = (url: string | null, sessionId: string) => {
  if (!url) return null
  try {
    const href = new URL(`/sessions/${encodeURIComponent(sessionId)}`, url).href
    return href.startsWith('https://') || href.startsWith('http://localhost')
      ? href
      : null
  } catch {
    return null
  }
}

/** The bar's words, left to right. */
export const barParts = (s: Standing) => {
  const parts: string[] = []
  if (s.oldNode) parts.push('needs Node 22.18+')
  else if (s.connection === 'connected')
    parts.push(s.org ? `connected · ${s.org}` : 'connected')
  else if (s.connection === 'refused') parts.push('key refused')
  else parts.push('not checked yet')

  if (s.unsent !== null) {
    parts.push(
      s.unsent === 0
        ? 'session synced'
        : `${s.unsent} Turn${s.unsent === 1 ? '' : 's'} behind`,
    )
  }
  if (s.queued > 0) parts.push(`${s.queued} queued`)
  return parts
}

export const dotColor = (s: Standing) =>
  s.oldNode || s.connection === 'refused'
    ? 'error'
    : s.connection === 'connected' && (s.unsent ?? 0) === 0 && s.queued === 0
      ? 'success'
      : 'warning'
