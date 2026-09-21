import type { TransactionSql } from 'postgres'

import type { LocalRange } from './series'

// Tickets 54, 55 and 56: the same question asked of three dimensions — who,
// what work, and which machine.
//
// One module rather than three, because the three differ in exactly one place
// each: the column they group by and the row they read a name from. Everything
// else — the range, the timezone, the token classes, what happens to an
// unpriced Turn, and which Turns the viewer may see at all — is the same and
// is already decided elsewhere. Three copies of that would be three chances to
// let one of them drift.
//
// Nothing here scopes by Role. `turns_read` does (ADR 0001): an Owner and an
// Admin see the Org, a Manager sees their Scope, a Member sees themselves, and
// the same call returns each of them a different set of rows. A page that
// filtered would be a second answer to a question the database already
// answers, and the one that goes stale.

export type Dimension = 'members' | 'projects' | 'devices'

export type BreakdownRow = {
  /** Stable per row: a Member, Project or Device id, or `null` for the
   * catch-all group. */
  id: string | null
  label: string
  /** A qualifier the surface shows beside the label, never instead of it. */
  note: string | null
  /**
   * Null when every Turn in the group is unpriced: `turn_costs` prices an
   * unknown model as null and `sum` over nulls is null. Kept null rather than
   * folded to zero, which is ADR 0002's rule — a zero understates while
   * looking authoritative, and this row is the one a reader is hunting for.
   */
  costUsd: number | null
  tokens: number
  turns: number
  unpricedTurns: number
}

type RawRow = {
  id: string | null
  label: string | null
  note: string | null
  cost_usd: string | null
  tokens: string
  turns: string
  unpriced_turns: string
  total_cost_usd: string | null
  total_tokens: string
  total_turns: string
  total_unpriced_turns: string
  groups: string
}

/**
 * How many groups one page shows. Devices and Projects grow without bound —
 * a year's range on a large Org has no natural ceiling — so the read is
 * capped rather than trusted to stay small, and the surface says how many it
 * left out.
 */
export const BREAKDOWN_LIMIT = 50

export type Breakdown = {
  rows: BreakdownRow[]
  /** Every group, not only the ones above: see the window in `AGGREGATES`. */
  totals: {
    costUsd: number
    tokens: number
    turns: number
    unpricedTurns: number
  }
  /** Groups beyond the cap, or zero. */
  more: number
}

/**
 * What every row of every breakdown is made of.
 *
 * The token sum is the four reported classes, as in `dailySpend`: the 5m and
 * 1h splits are subsets of the reported cache-creation total and thinking is a
 * subset of output, so adding either counts a token twice.
 */
const AGGREGATES = (tx: TransactionSql) => tx`
  sum(cost.cost_usd) as cost_usd,
  sum(
    turn.input_tokens + turn.output_tokens + turn.cache_read_input_tokens
      + turn.cache_creation_input_tokens
  ) as tokens,
  count(*) as turns,
  count(*) filter (where cost.unpriced) as unpriced_turns,
  -- The totals across every group, carried on each row by a window over the
  -- grouped aggregates. The row list is capped below, and a total summed from
  -- a capped list is a total that quietly drops the tail — on a page about
  -- money, the worse failure. One pass, no second statement to disagree with.
  sum(sum(cost.cost_usd)) over () as total_cost_usd,
  sum(sum(
    turn.input_tokens + turn.output_tokens + turn.cache_read_input_tokens
      + turn.cache_creation_input_tokens
  )) over () as total_tokens,
  sum(count(*)) over () as total_turns,
  sum(count(*) filter (where cost.unpriced)) over () as total_unpriced_turns,
  count(*) over () as groups
`

/**
 * Cost and tokens per Member, Project or Device over a range.
 *
 * The joins that fetch a name are `left` on purpose. `turns_read` and
 * `members_read` are not the same policy, and a Turn the viewer may read
 * whose *label* row they may not would silently vanish from an inner join —
 * turning a leak-proof policy into an undercount, which on a page about money
 * is the worse failure. An unreadable label comes back null and is named
 * rather than dropped.
 *
 * `device_id` and `project_id` are nullable columns besides: a Turn reported
 * before either was resolved belongs to the total, and the page says which
 * group it landed in.
 */
export const breakdown = async (
  tx: TransactionSql,
  orgId: string,
  timezone: string,
  range: LocalRange,
  dimension: Dimension,
): Promise<Breakdown> => {
  const from = tx`(${range.from}::date)::timestamp at time zone ${timezone}`
  const to = tx`(${range.to}::date)::timestamp at time zone ${timezone}`
  const source = tx`
      from turn_costs cost
      join turns turn on turn.id = cost.turn_id
  `
  // Both sides carry the qual so each reaches `turns_org_occurred_at_idx`:
  // `turn_costs` is a plain join over `turns` since ticket 81, and the planner
  // bounds both scans rather than pricing the deployment and discarding it.
  const filter = tx`
     where cost.org_id = ${orgId}
       and turn.org_id = ${orgId}
       and cost.occurred_at >= ${from} and cost.occurred_at < ${to}
       and turn.occurred_at >= ${from} and turn.occurred_at < ${to}
  `

  const rows = await (dimension === 'members'
    ? tx<RawRow[]>`
        select member.id as id,
               account.email as label,
               case when member.removed_at is not null then 'removed'
                    else null end as note,
               ${AGGREGATES(tx)}
          ${source}
          left join members member on member.id = turn.member_id
          left join users account on account.id = member.user_id
          ${filter}
         group by 1, 2, 3
         ${RANK(tx)}
      `
    : dimension === 'projects'
      ? tx<RawRow[]>`
          select project.id as id,
                 project.key as label,
                 project.remote as note,
                 ${AGGREGATES(tx)}
            ${source}
            left join projects project on project.id = turn.project_id
            ${filter}
           group by 1, 2, 3
           ${RANK(tx)}
        `
      : tx<RawRow[]>`
          select device.id as id,
                 coalesce(device.nickname, device.key) as label,
                 case when device.nickname is null then null
                      else device.key end as note,
                 ${AGGREGATES(tx)}
            ${source}
            left join devices device on device.id = turn.device_id
            ${filter}
           group by 1, 2, 3
           ${RANK(tx)}
        `)

  const first = rows[0]

  return {
    rows: ranked(rows, dimension),
    totals: {
      costUsd: Number(first?.total_cost_usd ?? 0),
      tokens: Number(first?.total_tokens ?? 0),
      turns: Number(first?.total_turns ?? 0),
      unpricedTurns: Number(first?.total_unpriced_turns ?? 0),
    },
    more: Math.max(0, Number(first?.groups ?? 0) - BREAKDOWN_LIMIT),
  }
}

/** Biggest first, and one more than the page shows so the cap is detectable. */
const RANK = (tx: TransactionSql) => tx`
  order by sum(cost.cost_usd) desc nulls last, count(*) desc
  limit ${BREAKDOWN_LIMIT + 1}
`

const ranked = (rows: RawRow[], dimension: Dimension): BreakdownRow[] =>
  rows
    .slice(0, BREAKDOWN_LIMIT)
    .map((row) => ({
      id: row.id,
      label: row.label ?? unnamed(dimension),
      note: row.note,
      costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
      tokens: Number(row.tokens),
      turns: Number(row.turns),
      unpricedTurns: Number(row.unpriced_turns),
    }))
    // The database has already ranked these; this only settles a tie between
    // two groups with the same cost and the same count, so the order is the
    // same on every read.
    .toSorted(
      (a, b) =>
        (b.costUsd ?? -1) - (a.costUsd ?? -1) ||
        b.turns - a.turns ||
        a.label.localeCompare(b.label),
    )

/**
 * What a row with no label row is called.
 *
 * Never "Unknown" on its own: the reader's next question is whether the money
 * is missing, and the answer is that it is in the total either way. Each of
 * these says what the group is rather than that something went wrong.
 */
const unnamed = (dimension: Dimension) =>
  dimension === 'members'
    ? 'Outside your view'
    : dimension === 'projects'
      ? 'No project reported'
      : 'No device reported'
