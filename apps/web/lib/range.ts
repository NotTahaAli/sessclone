import { addDays, currentMonth, type LocalRange } from './series'

// Ticket 53: the period every Costs view answers for.
//
// One control, built once, before the breakdowns that hang from it (54 to 56)
// exist to reimplement it. Three rules, from
// `docs/design/dashboard-wireframes.md`:
//
// **It lives in the URL**, so a link to a view is a link to a period. Nothing
// is stored: a range in a cookie or a preference row means two people reading
// the same link see different numbers, which is the failure the Org timezone
// exists to prevent one level down.
//
// **The default is the current calendar month**, which is the period a bill is
// drawn on.
//
// **It is read in the Org's timezone.** A preset is anchored on the Org's
// today, and a custom range is two calendar dates that mean instants only once
// the Org's zone is applied — which `dailySpend` does, in the query.

/** What the URL carries. A preset by name, or two dates. */
export type RangeParams = {
  range?: string | string[]
  from?: string | string[]
  to?: string | string[]
}

export type PresetKey =
  | 'this-month'
  | 'last-month'
  | 'last-7'
  | 'last-30'
  | 'last-90'
  | 'last-12-months'

export type Preset = { key: PresetKey; label: string }

/**
 * The presets, in the order they are offered.
 *
 * Calendar months first, because that is how a bill is drawn and how anybody
 * asks the question out loud; rolling windows after, because that is how a
 * trend is read.
 */
export const PRESETS: Preset[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-7', label: 'Last 7 days' },
  { key: 'last-30', label: 'Last 30 days' },
  { key: 'last-90', label: 'Last 90 days' },
  { key: 'last-12-months', label: 'Last 12 months' },
]

export const DEFAULT_PRESET: PresetKey = 'this-month'

/**
 * The longest range that may be asked for.
 *
 * A bar per day, and a query whose cost is the Turns inside the window: both
 * are fine at a year and neither is at a decade. A URL asking for more is
 * refused rather than served slowly, and the refusal is silent — it falls back
 * to the default, because a hand-edited date is a typo far more often than it
 * is an intention.
 */
const MAX_DAYS = 366

/** `YYYY-MM-DD` and nothing else. */
const DATE = /^\d{4}-\d{2}-\d{2}$/

const isDate = (value: string) =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

/** A single value, since a repeated query parameter arrives as an array. */
const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/** Days between two calendar dates. */
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  )

/** The first of the month `months` before `date`'s month. */
const monthStart = (date: string, months = 0) => {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7)) - 1 + months
  const shifted = new Date(Date.UTC(year, month, 1))
  return shifted.toISOString().slice(0, 10)
}

export const presetRange = (
  key: PresetKey,
  timezone: string,
  now: Date = new Date(),
): LocalRange => {
  const month = currentMonth(timezone, now)
  // The half-open end of a rolling window is tomorrow, so today's own Turns
  // are inside it: a "last 7 days" that stopped at last midnight would answer
  // a question nobody asked.
  const tomorrow = addDays(today(timezone, now), 1)

  switch (key) {
    case 'last-month':
      return { from: monthStart(month.from, -1), to: month.from }
    case 'last-7':
    case 'last-30':
    case 'last-90':
      return { from: addDays(tomorrow, -Number(key.slice(5))), to: tomorrow }
    case 'last-12-months':
      return { from: monthStart(month.from, -11), to: month.to }
    default:
      return month
  }
}

/** Today in the Org's timezone, as a calendar date. */
const today = (timezone: string, now: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)

export type ResolvedRange = {
  range: LocalRange
  /** The preset the URL named, or `null` when it carried dates of its own. */
  preset: PresetKey | null
}

/**
 * The range this request is asking for.
 *
 * Every rejection falls back to the default rather than erroring: these are
 * query parameters, which anybody may type and a stale link may carry, and a
 * Costs page that refuses to render because a date is malformed is worse than
 * one that shows this month and lets the reader choose again.
 */
export const resolveRange = (
  params: RangeParams,
  timezone: string,
  now: Date = new Date(),
): ResolvedRange => {
  const from = one(params.from)
  const to = one(params.to)

  if (from && to && isDate(from) && isDate(to)) {
    // `to` in the URL is the last day *counted*, inclusive, because that is
    // what a person means by "to the 12th" and what the date field beside it
    // shows. `LocalRange` is half-open, so it becomes the day after — the one
    // conversion, here, rather than a field that displays one date and
    // submits another.
    const days = daysBetween(from, to)
    if (days >= 0 && days < MAX_DAYS) {
      return { range: { from, to: addDays(to, 1) }, preset: null }
    }
  }

  const named = one(params.range)
  const preset =
    PRESETS.find((candidate) => candidate.key === named)?.key ?? DEFAULT_PRESET

  return { range: presetRange(preset, timezone, now), preset }
}

/**
 * The query string for a preset, kept in one place so links agree.
 *
 * `view` is the other thing in this URL, and the period does not own it
 * (tickets 54 to 56). Without carrying it, changing the period from a
 * breakdown tab silently answers a different question: the reader lands back
 * on Over time having asked only for a different month.
 */
export const presetHref = (path: string, key: PresetKey, view?: string) => {
  const query = new URLSearchParams()
  if (view) query.set('view', view)
  if (key !== DEFAULT_PRESET) query.set('range', key)
  const search = query.toString()
  return search ? `${path}?${search}` : path
}
