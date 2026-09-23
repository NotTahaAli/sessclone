import type { Dimension } from '../../../lib/breakdown'

// The Costs views, as `docs/design/product-ia.md` lists them: one question
// about one period, asked four ways.
//
// The view is in the URL beside the range, for the same reason the range is —
// a link to a breakdown is a link to that breakdown — and the range survives
// the switch, because the reader is changing the cut and not the question.

export type View = 'time' | Dimension | 'failures'

export const VIEWS: { key: View; label: string }[] = [
  { key: 'time', label: 'Over time' },
  { key: 'members', label: 'People' },
  { key: 'projects', label: 'Projects' },
  { key: 'devices', label: 'Devices' },
  // Ticket 78: a fifth tab, because "why did nothing arrive" is a question
  // about the same period as "what did we spend". It carries a count badge
  // when the range holds any failure.
  { key: 'failures', label: 'Failures' },
]

export const DEFAULT_VIEW: View = 'time'

/** The three breakdown dimensions, apart from `time` and `failures`. */
export const isDimension = (view: View): view is Dimension =>
  view === 'members' || view === 'projects' || view === 'devices'

/** The view the URL names, or the default. Never an error: it is a URL. */
export const resolveView = (value: string | string[] | undefined): View => {
  const named = Array.isArray(value) ? value[0] : value
  return VIEWS.find((view) => view.key === named)?.key ?? DEFAULT_VIEW
}

/**
 * The link to a view, keeping whatever period is current.
 *
 * Built from the current query rather than from scratch, so switching the cut
 * cannot quietly reset the range — which would answer a different question
 * than the reader asked.
 */
export const viewHref = (
  path: string,
  view: View,
  params: Record<string, string | string[] | undefined>,
): string => {
  const query = new URLSearchParams()
  for (const key of ['range', 'from', 'to'] as const) {
    const value = params[key]
    const one = Array.isArray(value) ? value[0] : value
    if (one) query.set(key, one)
  }
  if (view !== DEFAULT_VIEW) query.set('view', view)

  const search = query.toString()
  return search ? `${path}?${search}` : path
}

/** What an Over time row or bar opens in the Finder column. */
export type TimeColumn =
  { kind: 'day'; date: string } | { kind: 'model'; model: string }

/**
 * `?open=day:2026-09-23` or `?open=model:claude-opus-4-6`, or nothing. A
 * value that names no real calendar date or no model opens nothing rather
 * than failing the page: it is a URL, and anybody can type one.
 */
export const resolveTimeColumn = (
  value: string | undefined,
): TimeColumn | null => {
  if (!value) return null
  const colon = value.indexOf(':')
  const [kind, rest] = [value.slice(0, colon), value.slice(colon + 1)]
  if (kind === 'model' && rest && rest.length <= 200) {
    return { kind, model: rest }
  }
  if (
    kind === 'day' &&
    /^\d{4}-\d{2}-\d{2}$/.test(rest) &&
    new Date(`${rest}T00:00:00Z`).toISOString().startsWith(rest)
  ) {
    return { kind, date: rest }
  }
  return null
}

/**
 * Which bars get a date under them: the first, the last, and today when it
 * is in the range and far enough from both ends not to print over them.
 */
export const tickDates = (dates: string[], today: string): string[] => {
  const first = dates[0]
  const last = dates.at(-1)
  if (!first || !last) return []
  const at = dates.indexOf(today)
  const room = Math.max(2, Math.round(dates.length / 5))
  return [
    first,
    ...(at >= room && at <= dates.length - 1 - room ? [today] : []),
    ...(last === first ? [] : [last]),
  ]
}
