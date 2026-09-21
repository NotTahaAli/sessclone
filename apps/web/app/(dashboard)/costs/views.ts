import type { Dimension } from '../../../lib/breakdown'

// The Costs views, as `docs/design/product-ia.md` lists them: one question
// about one period, asked four ways.
//
// The view is in the URL beside the range, for the same reason the range is —
// a link to a breakdown is a link to that breakdown — and the range survives
// the switch, because the reader is changing the cut and not the question.

export type View = 'time' | Dimension

export const VIEWS: { key: View; label: string }[] = [
  { key: 'time', label: 'Over time' },
  { key: 'members', label: 'People' },
  { key: 'projects', label: 'Projects' },
  { key: 'devices', label: 'Devices' },
]

export const DEFAULT_VIEW: View = 'time'

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
