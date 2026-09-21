import type { TransactionSql } from 'postgres'

// Ticket 52: spend over time, which is the first chart in the product and the
// one every later breakdown is cut from.
//
// Three decisions live here rather than in the page.
//
// **The bucket is a calendar day in the Org's timezone** (ticket 51), not a
// UTC day and not the reader's. `occurred_at` is an instant; which day it
// falls on is the Org's question, and changing the setting re-buckets what is
// already collected because nothing stored moves. That is the same expression
// `turn_costs` prices on, so a Turn is never charged at Monday's rate and
// drawn on Sunday's bar.
//
// **A range is two calendar dates, not two instants.** "September" is a pair
// of local dates, and the instants they mean depend on the timezone — so the
// conversion happens once, in the query, where the timezone is already known.
// A page that did it in JavaScript would need a timezone database to be right
// about it.
//
// **An unpriced Turn is counted, never summed.** `sum` skips nulls, so a total
// over a range holding unpriced Turns is the priced subset with nothing on it
// saying so. Every shape here carries the unpriced count beside the figure,
// for the same reason `lib/spend.ts` does.

/** A half-open window of calendar days, `YYYY-MM-DD`, in the Org's timezone. */
export type LocalRange = { from: string; to: string }

/** `YYYY-MM-DD` for an instant, in the given timezone. */
const localDate = (timezone: string, at: Date): string =>
  // `en-CA` is ISO order, which is the one thing wanted from a locale here.
  // `Intl` carries the timezone database the browser and Node already ship, so
  // this needs no dependency and no table of offsets to go stale.
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)

/** `YYYY-MM-DD`, `days` later. Calendar arithmetic, so no offset applies. */
export const addDays = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * The current calendar month in the Org's timezone.
 *
 * The default range, because `docs/design/dashboard-wireframes.md` says so and
 * says why: it is the period a bill is drawn on.
 */
export const currentMonth = (
  timezone: string,
  now: Date = new Date(),
): LocalRange => {
  const today = localDate(timezone, now)
  const from = `${today.slice(0, 7)}-01`
  const [year, month] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  const to =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`
  return { from, to }
}

/** One Org, one day, one model. */
export type SpendRow = {
  date: string
  model: string | null
  /** Null when every Turn in the cell is unpriced. */
  costUsd: number | null
  tokens: number
  turns: number
  unpricedTurns: number
}

type RawRow = {
  date: string
  model: string | null
  cost_usd: string | null
  tokens: string
  turns: string
  unpriced_turns: string
}

/**
 * Spend per day per model, over a range, in the Org's timezone.
 *
 * `turn_costs` is joined back to `turns` for the model and the token counts,
 * which the view does not carry. Both quals are repeated on both sides so each
 * reaches `turns_org_occurred_at_idx`: the view is a plain join over `turns`
 * since ticket 81, so the planner bounds both scans to the range rather than
 * pricing the deployment and discarding it.
 *
 * Measured on one box at 200k Turns, 100k in the target Org, over a 31-day
 * range holding 20,832 of them: 0.46s, against 0.44s for the same range
 * through `orgSpend`, which reads one side. Both sides come back through
 * `turns_org_occurred_at_idx` and the join is a hash on the primary key, so
 * the model and the tokens cost about 5% rather than a second scan of the
 * deployment.
 *
 * `org_id` is a filter and not the authorisation — `turns_read` is (ADR 0001),
 * so a Manager gets their Scope's days and a Member their own, through the
 * same query.
 *
 * The tokens summed are the four *reported* classes. The 5m and 1h splits are
 * subsets of `cache_creation_input_tokens`, and thinking is a subset of
 * output, so adding either would count the same token twice.
 */
export const dailySpend = async (
  tx: TransactionSql,
  orgId: string,
  timezone: string,
  range: LocalRange,
): Promise<SpendRow[]> => {
  const rows = await tx<RawRow[]>`
    select to_char(
             (turn.occurred_at at time zone ${timezone})::date, 'YYYY-MM-DD'
           ) as date,
           turn.model,
           sum(cost.cost_usd) as cost_usd,
           sum(
             turn.input_tokens + turn.output_tokens
               + turn.cache_read_input_tokens
               + turn.cache_creation_input_tokens
           ) as tokens,
           count(*) as turns,
           count(*) filter (where cost.unpriced) as unpriced_turns
      from turn_costs cost
      join turns turn on turn.id = cost.turn_id
     where cost.org_id = ${orgId}
       and turn.org_id = ${orgId}
       and cost.occurred_at
             >= (${range.from}::date)::timestamp at time zone ${timezone}
       and cost.occurred_at
             < (${range.to}::date)::timestamp at time zone ${timezone}
       and turn.occurred_at
             >= (${range.from}::date)::timestamp at time zone ${timezone}
       and turn.occurred_at
             < (${range.to}::date)::timestamp at time zone ${timezone}
     group by 1, 2
  `

  return rows.map((row) => ({
    date: row.date,
    model: row.model,
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    tokens: Number(row.tokens),
    turns: Number(row.turns),
    unpricedTurns: Number(row.unpriced_turns),
  }))
}

/** A colour slot. Assigned by value, largest first; `other` always sorts last. */
export type Slot = 1 | 2 | 3 | 4 | 5 | 'other'

/** One model, or the roll-up of everything past the fifth. */
export type Series = { label: string; slot: Slot; costUsd: number }

/** One bar. */
export type Day = {
  date: string
  /** The priced part, in slot order. A day with no spend has none. */
  segments: { label: string; slot: Slot; costUsd: number }[]
  costUsd: number
  tokens: number
  turns: number
  unpricedTurns: number
}

export type SpendSeries = {
  days: Day[]
  /** The legend, in slot order. */
  series: Series[]
  costUsd: number
  tokens: number
  turns: number
  unpricedTurns: number
}

/** What the design system will draw a model-less Turn as. */
const UNKNOWN_MODEL = 'No model reported'

/** Five slots and a sixth that is everything else. */
const SLOTS = 5

/**
 * The rows, as the chart draws them: every day in the range present, the five
 * largest models in their own slots, and everything else in Other.
 *
 * Pure, and separate from the read, because this is where the rules that are
 * easy to get quietly wrong live — a day with no Turns is a gap in the bars
 * rather than a missing bar, and Other sorts last by rule rather than by
 * value.
 */
export const spendSeries = (
  rows: SpendRow[],
  range: LocalRange,
): SpendSeries => {
  const byModel = new Map<string, number>()
  for (const row of rows) {
    const label = row.model ?? UNKNOWN_MODEL
    byModel.set(label, (byModel.get(label) ?? 0) + (row.costUsd ?? 0))
  }

  const ranked = [...byModel.entries()]
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, costUsd]) => ({ label, costUsd }))

  // The slot a label is drawn in, decided once for the whole chart so a model
  // keeps its colour from the first bar to the last.
  // The five slots as values rather than a computed number, so the narrowing
  // is the array's and not an assertion's.
  const ORDER: Slot[] = [1, 2, 3, 4, 5]
  const slots = new Map<string, Slot>()
  ranked.forEach(({ label }, index) => {
    slots.set(label, ORDER[index] ?? 'other')
  })

  const series: Series[] = ranked.slice(0, SLOTS).map(({ label, costUsd }) => ({
    label,
    slot: slots.get(label)!,
    costUsd,
  }))
  const rest = ranked.slice(SLOTS)
  if (rest.length > 0) {
    series.push({
      label: 'Other',
      slot: 'other',
      costUsd: rest.reduce((sum, model) => sum + model.costUsd, 0),
    })
  }

  const byDate = new Map<string, SpendRow[]>()
  for (const row of rows) {
    let group = byDate.get(row.date)
    if (!group) byDate.set(row.date, (group = []))
    group.push(row)
  }

  const days: Day[] = []
  for (let date = range.from; date < range.to; date = addDays(date, 1))
  // A range is a handful of days to a year; `docs/design/…` offers no preset
  // past twelve months and ticket 53's parser refuses a longer one, so this
  // is bounded by the control rather than by hope.
  {
    const group = byDate.get(date) ?? []

    // One segment per slot, so a day holding two models that both rolled into
    // Other draws one Other block rather than two.
    const segments = new Map<Slot, { label: string; costUsd: number }>()
    let costUsd = 0
    let tokens = 0
    let turns = 0
    let unpricedTurns = 0

    for (const row of group) {
      const label = row.model ?? UNKNOWN_MODEL
      const slot = slots.get(label)!
      const name = slot === 'other' ? 'Other' : label
      const existing = segments.get(slot)
      segments.set(slot, {
        label: name,
        costUsd: (existing?.costUsd ?? 0) + (row.costUsd ?? 0),
      })
      costUsd += row.costUsd ?? 0
      tokens += row.tokens
      turns += row.turns
      unpricedTurns += row.unpricedTurns
    }

    days.push({
      date,
      segments: series
        .map((entry) => {
          const segment = segments.get(entry.slot)
          return segment && segment.costUsd > 0
            ? {
                label: segment.label,
                slot: entry.slot,
                costUsd: segment.costUsd,
              }
            : null
        })
        .filter((segment) => segment !== null),
      costUsd,
      tokens,
      turns,
      unpricedTurns,
    })
  }

  return {
    days,
    series,
    costUsd: days.reduce((sum, day) => sum + day.costUsd, 0),
    tokens: days.reduce((sum, day) => sum + day.tokens, 0),
    turns: days.reduce((sum, day) => sum + day.turns, 0),
    unpricedTurns: days.reduce((sum, day) => sum + day.unpricedTurns, 0),
  }
}
