// Ticket 112: one way to build a link that changes one thing in the URL and
// keeps the rest. Costs and Sessions put the period, the cut, the filters and
// the open column (the Finder column on desktop) all in the query, and a link
// that rebuilt the query from scratch would drop whichever of them it forgot —
// answering a different question than the one the reader asked.

export type Query = Record<string, string | string[] | undefined>

/** The first value of one key, as a page reads it. */
export const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * `path` with the current query, `patch` applied: a string sets a key, an
 * `undefined` removes it. A page cursor never survives a change, since the
 * page it pointed into is a different list now.
 */
export const hrefWith = (
  path: string,
  query: Query,
  patch: Record<string, string | undefined>,
): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const first = one(value)
    if (first && key !== 'before' && key !== 'after') search.set(key, first)
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '') search.delete(key)
    else search.set(key, value)
  }
  const text = search.toString()
  return text ? `${path}?${text}` : path
}
