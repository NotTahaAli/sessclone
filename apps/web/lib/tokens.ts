import type { TransactionSql } from 'postgres'

import type { LocalRange } from './series'

// Taha, 2026-09-23: every Costs column (a model, a day, a person, a Project,
// a Device) opens with its tokens by class, each with its cost, then the
// total; and every column but a model's splits those tokens by model.
//
// One statement per column, whatever the cut. The cut's Turns are read once,
// both quals on both sides so the scan lands on `turns_org_occurred_at_idx`
// (ticket 81), into a materialised set that three aggregates read:
//
//  - the classes, grouped by model, Org day and price multiplier, so
//    `sessclone_resolve_rate` — the definition of record for which Rate
//    applies — runs once per class per group rather than once per Turn;
//  - the total, from `turn_costs` itself, the figure every other Costs number
//    adds up: a Turn with one unpriced class is left out of it whole, and web
//    requests are in it and in no token class;
//  - the Sessions, counted distinct per model and overall, because a Session
//    that used two models is one Session.
//
// Cache write is one class, the reported creation total, never the 5m and 1h
// splits beside it: those are subsets of the total, and listing all three
// counts the same token twice. Its cost is each split at its own Rate; a total
// with no split has no Rate, so the class reads as unpriced, as on a Turn.
//
// `org_id` is a filter and not the authorisation: `turns_read` is (ADR 0001),
// so a Manager's column holds their Scope's Turns and a Member's their own.

/** Which Turns a column is about. `all` is a day's column: the range is the
 * day. A null id is the group with none (no Project, no Device, no model). */
export type TokenCut =
  | { kind: 'all' }
  | { kind: 'model'; model: string | null }
  | { kind: 'members'; id: string }
  | { kind: 'projects'; id: string | null }
  | { kind: 'devices'; id: string | null }

export type TokenClass = {
  key: 'input' | 'output' | 'cache_read' | 'cache_write'
  label: string
  tokens: number
  /** Null when some of these tokens have no Rate: unknown, never zero. */
  costUsd: number | null
}

export type TokenTotals = {
  classes: TokenClass[]
  tokens: number
  /** `turn_costs`' own total; null when nothing in the cut is priced. */
  costUsd: number | null
  sessions: number
  unpricedTurns: number
}

export type TokenBreakdown = TokenTotals & {
  /** One per model, costliest first. `model` is null for Turns that reported
   * none. */
  models: (TokenTotals & { model: string | null })[]
}

type Raw = {
  model: string | null
  input: string
  output: string
  cache_read: string
  cache_write: string
  input_usd: string | null
  output_usd: string | null
  cache_read_usd: string | null
  cache_write_usd: string | null
  input_gap: boolean
  output_gap: boolean
  cache_read_gap: boolean
  cache_write_gap: boolean
  cost_usd: string | null
  unpriced_turns: string
  sessions: string
  all_sessions: string
}

const LABELS: [TokenClass['key'], string][] = [
  ['input', 'Input'],
  ['output', 'Output'],
  ['cache_read', 'Cache read'],
  ['cache_write', 'Cache write'],
]

const cutFilter = (tx: TransactionSql, cut: TokenCut) => {
  switch (cut.kind) {
    case 'model':
      return tx`and turn.model is not distinct from ${cut.model}::text`
    case 'members':
      return tx`and turn.member_id = ${cut.id}`
    case 'projects':
      return cut.id === null
        ? tx`and turn.project_id is null`
        : tx`and turn.project_id = ${cut.id}`
    case 'devices':
      return cut.id === null
        ? tx`and turn.device_id is null`
        : tx`and turn.device_id = ${cut.id}`
    default:
      return tx``
  }
}

const totalsOf = (row: Raw): TokenTotals => {
  const classes = LABELS.map(([key, label]): TokenClass => {
    const tokens = Number(row[key])
    return {
      key,
      label,
      tokens,
      costUsd:
        tokens === 0 ? 0 : row[`${key}_gap`] ? null : Number(row[`${key}_usd`]),
    }
  })
  return {
    classes,
    tokens: classes.reduce((sum, entry) => sum + entry.tokens, 0),
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    sessions: Number(row.sessions),
    unpricedTurns: Number(row.unpriced_turns),
  }
}

/** The tokens by class of one cut over a range, and by model. One statement. */
export const tokenBreakdown = async (
  tx: TransactionSql,
  orgId: string,
  timezone: string,
  range: LocalRange,
  cut: TokenCut,
): Promise<TokenBreakdown> => {
  const from = tx`(${range.from}::date)::timestamp at time zone ${timezone}`
  const to = tx`(${range.to}::date)::timestamp at time zone ${timezone}`

  const rows = await tx<Raw[]>`
    with picked as materialized (
      select turn.member_id, turn.session_id, turn.model,
             (turn.occurred_at at time zone ${timezone})::date as on_date,
             sessclone_price_multiplier(
               turn.model, turn.speed, turn.inference_geo, turn.service_tier
             ) as multiplier,
             turn.input_tokens, turn.output_tokens,
             turn.cache_read_input_tokens,
             turn.cache_creation_input_tokens,
             turn.cache_creation_5m_input_tokens,
             turn.cache_creation_1h_input_tokens,
             cost.cost_usd, cost.unpriced
        from turn_costs cost
        join turns turn on turn.id = cost.turn_id
       where cost.org_id = ${orgId}
         and turn.org_id = ${orgId}
         and cost.occurred_at >= ${from} and cost.occurred_at < ${to}
         and turn.occurred_at >= ${from} and turn.occurred_at < ${to}
         ${cutFilter(tx, cut)}
    ),
    cell as (
      select model, on_date, multiplier,
             sum(input_tokens) as input,
             sum(output_tokens) as output,
             sum(cache_read_input_tokens) as cache_read,
             sum(cache_creation_input_tokens) as cache_write,
             sum(cache_creation_5m_input_tokens) as cache_5m,
             sum(cache_creation_1h_input_tokens) as cache_1h,
             sum(cost_usd) as cost_usd,
             count(*) filter (where unpriced) as unpriced_turns
        from picked
       group by 1, 2, 3
    ),
    priced as (
      select cell.*,
             sessclone_resolve_rate(${orgId}::uuid, model, 'input', on_date) as input_rate,
             sessclone_resolve_rate(${orgId}::uuid, model, 'output', on_date) as output_rate,
             sessclone_resolve_rate(${orgId}::uuid, model, 'cache_read', on_date) as cache_read_rate,
             sessclone_resolve_rate(${orgId}::uuid, model, 'cache_write_5m', on_date) as cache_5m_rate,
             sessclone_resolve_rate(${orgId}::uuid, model, 'cache_write_1h', on_date) as cache_1h_rate
        from cell
    ),
    by_model as (
      -- Spelled the way turn_costs spells it, quantity * price * multiplier
      -- / 1000000, so the lines agree with the view's arithmetic.
      select model,
             sum(input) as input,
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
             coalesce(bool_or(input > 0 and input_rate is null), false)
               as input_gap,
             coalesce(bool_or(output > 0 and output_rate is null), false)
               as output_gap,
             coalesce(bool_or(cache_read > 0 and cache_read_rate is null), false)
               as cache_read_gap,
             coalesce(bool_or(cache_write > cache_5m + cache_1h
                              or (cache_5m > 0 and cache_5m_rate is null)
                              or (cache_1h > 0 and cache_1h_rate is null)),
                      false) as cache_write_gap,
             sum(cost_usd) as cost_usd,
             sum(unpriced_turns) as unpriced_turns
        from priced
       group by model
    ),
    counted as (
      select model, grouping(model) as everything,
             count(distinct (member_id, session_id)) as sessions
        from picked
       group by grouping sets ((model), ())
    )
    select by_model.*,
           per_model.sessions,
           (select sessions from counted where everything = 1) as all_sessions
      from by_model
      join counted per_model
        on per_model.everything = 0
       and per_model.model is not distinct from by_model.model
     order by by_model.cost_usd desc nulls last, by_model.model
  `

  const models = rows.map((row) => ({ model: row.model, ...totalsOf(row) }))

  // The cut's own line is the models added up, class by class. A class is
  // unknown overall when it is unknown for any model: a floor dressed as a
  // total is the failure ADR 0002 names.
  const classes = LABELS.map(([key, label]): TokenClass => {
    const lines = models.map((model) =>
      model.classes.find((entry) => entry.key === key)!,
    )
    return {
      key,
      label,
      tokens: lines.reduce((sum, line) => sum + line.tokens, 0),
      costUsd: lines.some((line) => line.costUsd === null)
        ? null
        : lines.reduce((sum, line) => sum + (line.costUsd ?? 0), 0),
    }
  })
  const priced = models.filter((model) => model.costUsd !== null)

  return {
    classes,
    tokens: classes.reduce((sum, entry) => sum + entry.tokens, 0),
    costUsd:
      priced.length === 0
        ? null
        : priced.reduce((sum, model) => sum + model.costUsd!, 0),
    sessions: Number(rows[0]?.all_sessions ?? 0),
    unpricedTurns: models.reduce((sum, model) => sum + model.unpricedTurns, 0),
    models,
  }
}
