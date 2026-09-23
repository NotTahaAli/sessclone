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
  /** Null when nothing in the period is priced: never a confident zero. */
  costUsd: number | null
  tokens: number
  turns: number
  unpricedTurns: number
}

/** What the design system will draw a model-less Turn as. */
export const UNKNOWN_MODEL = 'No model reported'

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
    // Summed over the rows rather than over `days`. The two agree only while
    // every row's bucket falls inside the loop's dates, and those are two
    // expressions for one boundary: `at time zone` in SQL against date
    // strings here. In a zone whose DST transition lands on midnight they can
    // disagree, and a row outside the loop would drop out of the totals while
    // still being a Turn the reader spent money on.
    costUsd: rows.every((row) => row.costUsd === null)
      ? null
      : rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    tokens: rows.reduce((sum, row) => sum + row.tokens, 0),
    turns: rows.reduce((sum, row) => sum + row.turns, 0),
    unpricedTurns: rows.reduce((sum, row) => sum + row.unpricedTurns, 0),
  }
}

/** One token class of a model's period: how many, and what they cost. */
export type ModelClass = {
  key: 'input' | 'output' | 'cache_read' | 'cache_write'
  label: string
  tokens: number
  /** Null when some of these tokens have no Rate: unknown, never zero. */
  costUsd: number | null
}

export type ModelBreakdown = {
  classes: ModelClass[]
  tokens: number
  /** `turn_costs`' own total, the figure the By model row shows. */
  costUsd: number | null
  turns: number
  unpricedTurns: number
}

type RawModel = {
  input: string | null
  output: string | null
  cache_read: string | null
  cache_write: string | null
  input_usd: string | null
  output_usd: string | null
  cache_read_usd: string | null
  cache_write_usd: string | null
  input_gap: boolean | null
  output_gap: boolean | null
  cache_read_gap: boolean | null
  cache_write_gap: boolean | null
  cost_usd: string | null
  turns: string
  unpriced_turns: string
}

/** A class's token count, from a `sum` that is null over no rows. */
const tokenCount = (value: string | null | undefined) => Number(value ?? 0)
const classCost = (
  count: number,
  value: string | null | undefined,
  gap: boolean | null | undefined,
) => (count === 0 ? 0 : gap ? null : Number(value ?? 0))

const classLine = (
  key: ModelClass['key'],
  label: string,
  count: string | null | undefined,
  usd: string | null | undefined,
  gap: boolean | null | undefined,
): ModelClass => ({
  key,
  label,
  tokens: tokenCount(count),
  costUsd: classCost(tokenCount(count), usd, gap),
})

/**
 * One model's tokens over a range, by class, each with its cost.
 *
 * One statement and one scan. The Turns are grouped by the two things a Rate
 * depends on — the day in the Org's timezone and the modifiers' multiplier —
 * so `sessclone_resolve_rate`, the definition of record for which Rate
 * applies, runs once per class per group (a month is a few dozen groups)
 * rather than once per Turn. The scan is `dailySpend`'s: both quals on both
 * sides, so it lands on `turns_org_occurred_at_idx`.
 *
 * Cache write is one class, the reported creation total, never the 5m and 1h
 * splits beside it: those are subsets of the total, and listing all three
 * counts the same token twice. Its cost is each split at its own Rate; a
 * total with no split has no Rate, so it reads as unpriced, as on a Turn.
 *
 * The total is `turn_costs`' sum, as every other Costs figure is, rather than
 * a sum of the lines: a Turn with one unpriced class is left out of the view's
 * total whole, and web requests are in it and in no token class.
 */
export const modelBreakdown = async (
  tx: TransactionSql,
  orgId: string,
  timezone: string,
  range: LocalRange,
  model: string | null,
): Promise<ModelBreakdown> => {
  const from = tx`(${range.from}::date)::timestamp at time zone ${timezone}`
  const to = tx`(${range.to}::date)::timestamp at time zone ${timezone}`

  const [row] = await tx<RawModel[]>`
    with cell as (
      select (turn.occurred_at at time zone ${timezone})::date as on_date,
             sessclone_price_multiplier(
               turn.model, turn.speed, turn.inference_geo, turn.service_tier
             ) as multiplier,
             sum(turn.input_tokens) as input,
             sum(turn.output_tokens) as output,
             sum(turn.cache_read_input_tokens) as cache_read,
             sum(turn.cache_creation_input_tokens) as cache_write,
             sum(turn.cache_creation_5m_input_tokens) as cache_5m,
             sum(turn.cache_creation_1h_input_tokens) as cache_1h,
             sum(cost.cost_usd) as cost_usd,
             count(*) as turns,
             count(*) filter (where cost.unpriced) as unpriced_turns
        from turn_costs cost
        join turns turn on turn.id = cost.turn_id
       where cost.org_id = ${orgId}
         and turn.org_id = ${orgId}
         and cost.occurred_at >= ${from} and cost.occurred_at < ${to}
         and turn.occurred_at >= ${from} and turn.occurred_at < ${to}
         and turn.model is not distinct from ${model}
       group by 1, 2
    ),
    priced as (
      select cell.*,
             sessclone_resolve_rate(${orgId}::uuid, ${model}::text, 'input', on_date) as input_rate,
             sessclone_resolve_rate(${orgId}::uuid, ${model}::text, 'output', on_date) as output_rate,
             sessclone_resolve_rate(${orgId}::uuid, ${model}::text, 'cache_read', on_date) as cache_read_rate,
             sessclone_resolve_rate(${orgId}::uuid, ${model}::text, 'cache_write_5m', on_date) as cache_5m_rate,
             sessclone_resolve_rate(${orgId}::uuid, ${model}::text, 'cache_write_1h', on_date) as cache_1h_rate
        from cell
    )
    select sum(input) as input,
           sum(output) as output,
           sum(cache_read) as cache_read,
           sum(cache_write) as cache_write,
           sum(input * input_rate * multiplier / 1000000) as input_usd,
           sum(output * output_rate * multiplier / 1000000) as output_usd,
           sum(cache_read * cache_read_rate * multiplier / 1000000)
             as cache_read_usd,
           sum(coalesce(cache_5m * cache_5m_rate * multiplier / 1000000, 0)
               + coalesce(cache_1h * cache_1h_rate * multiplier / 1000000, 0))
             as cache_write_usd,
           bool_or(input > 0 and input_rate is null) as input_gap,
           bool_or(output > 0 and output_rate is null) as output_gap,
           bool_or(cache_read > 0 and cache_read_rate is null) as cache_read_gap,
           bool_or(cache_write > cache_5m + cache_1h
                   or (cache_5m > 0 and cache_5m_rate is null)
                   or (cache_1h > 0 and cache_1h_rate is null))
             as cache_write_gap,
           sum(cost_usd) as cost_usd,
           coalesce(sum(turns), 0) as turns,
           coalesce(sum(unpriced_turns), 0) as unpriced_turns
      from priced
  `

  const classes = [
    classLine('input', 'Input', row?.input, row?.input_usd, row?.input_gap),
    classLine(
      'output',
      'Output',
      row?.output,
      row?.output_usd,
      row?.output_gap,
    ),
    classLine(
      'cache_read',
      'Cache read',
      row?.cache_read,
      row?.cache_read_usd,
      row?.cache_read_gap,
    ),
    classLine(
      'cache_write',
      'Cache write',
      row?.cache_write,
      row?.cache_write_usd,
      row?.cache_write_gap,
    ),
  ]

  return {
    classes,
    tokens: classes.reduce((sum, entry) => sum + entry.tokens, 0),
    costUsd: row?.cost_usd == null ? null : Number(row.cost_usd),
    turns: Number(row?.turns ?? 0),
    unpricedTurns: Number(row?.unpriced_turns ?? 0),
  }
}
