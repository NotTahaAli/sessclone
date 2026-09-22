import type { TransactionSql } from 'postgres'

import type { LocalRange } from './series'

// Tickets 86 and 88: the Turns themselves, and what one Turn consumed.
//
// Everything above this is an aggregate. `spend.ts` totals a period,
// `breakdown.ts` ranks a dimension, and a ranked row has been a dead end since
// ticket 54 — a name and a figure with nothing underneath it. This is what is
// underneath: the Turns of a cut, and then the quantities of one Turn.
//
// One module, two callers, deliberately. Ticket 88 lists the Turns of a ranked
// row and ticket 86 lists the Turns of a Session; they differ in the filter and
// in the direction, and in nothing else. The ticket says so outright — "This
// Turn row and this breakdown are the components ticket 86's session detail
// uses. One implementation, two callers" — so the difference is two arguments
// rather than two files.
//
// Nothing here scopes by Role. `turns_read` does (ADR 0001): an Owner and an
// Admin see the Org, a Manager their Scope, a Member themselves, and the same
// call hands each of them a different set of rows. A page that filtered too
// would be a second answer to a question the database already answers, and the
// one that goes stale.

/** How many Turns one page shows. A single Session can hold hundreds. */
export const TURN_PAGE = 50

export type TurnRow = {
  /** `turns.id`, as text: it is a bigint, and JavaScript rounds those. */
  id: string
  /** ISO 8601 in UTC. The surface formats it in the Org's timezone. */
  occurredAt: string
  sessionId: string
  /** Null for a main Session; set when the Turn ran inside an Agent Run. */
  agentId: string | null
  /** Null when no Project was reported, or the row is not the viewer's to
   * read — the `left` join below says why that is not the same thing. */
  projectKey: string | null
  model: string | null
  /** Null, never zero, when a quantity the Turn consumed has no Rate. */
  costUsd: number | null
  unpriced: boolean
  /** The four reported classes, as everywhere else: the 5m and 1h splits are
   * subsets of the cache-creation total and thinking is a subset of output, so
   * adding either counts a token twice. */
  tokens: number
  /** False when the run died mid-stream, so these counters are a floor. */
  complete: boolean
}

/**
 * Which Turns a list is asking for.
 *
 * A ranked row (ticket 88) is a `dimension` and the id of the group that was
 * clicked; a Session (ticket 86) is its Member and its session id. Both are
 * equality on a column with a `(column, occurred_at)` index behind it, which
 * is what keeps the read index-backed rather than a sort over the period.
 */
export type TurnFilter =
  | { kind: 'members'; id: string }
  | { kind: 'projects'; id: string | null }
  | { kind: 'devices'; id: string | null }
  | { kind: 'session'; memberId: string; sessionId: string }

/** `(occurred_at, id)`, because `occurred_at` alone is not unique and a page
 * boundary that repeats or skips a row is worse than no paging at all. */
export type TurnCursor = { occurredAt: string; id: string }

type RawTurn = {
  id: string
  occurred_at: Date
  session_id: string
  agent_id: string | null
  project_key: string | null
  model: string | null
  cost_usd: string | null
  unpriced: boolean
  tokens: string
  complete: boolean
}

/**
 * The columns every Turn row is made of, so the list and the breakdown cannot
 * disagree about what a Turn's tokens are.
 */
const TURN_COLUMNS = (tx: TransactionSql) => tx`
  turn.id::text as id,
  turn.occurred_at,
  turn.session_id,
  turn.agent_id,
  project.key as project_key,
  turn.model,
  cost.cost_usd,
  cost.unpriced,
  turn.input_tokens + turn.output_tokens + turn.cache_read_input_tokens
    + turn.cache_creation_input_tokens as tokens,
  turn.complete
`

const asRow = (row: RawTurn): TurnRow => ({
  id: row.id,
  occurredAt: row.occurred_at.toISOString(),
  sessionId: row.session_id,
  agentId: row.agent_id,
  projectKey: row.project_key,
  model: row.model,
  costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
  unpriced: row.unpriced,
  tokens: Number(row.tokens),
  complete: row.complete,
})

/**
 * The Turns of one cut, paginated.
 *
 * `range` bounds a ranked row's list to the period the reader chose; a Session
 * is its own bound, so it passes none and gets every Turn of that Session
 * whatever period is selected — a Session that straddles midnight on the last
 * day of the month is one Session, not two halves.
 *
 * `order` is the one other difference between the callers: a ranked row reads
 * newest first, because the question is what has been costing money lately; a
 * Session reads oldest first, because the question is what happened.
 *
 * The `left` join onto `projects` is the rule `breakdown` states: `turns_read`
 * and `projects_read` are not the same policy, so a Turn the viewer may read
 * whose Project row they may not would vanish from an inner join — turning a
 * leak-proof policy into an undercount on a page about money. An unreadable
 * key comes back null and is named rather than dropped.
 */
export const turnList = async (
  tx: TransactionSql,
  orgId: string,
  filter: TurnFilter,
  {
    timezone,
    range,
    order = 'desc',
    limit = TURN_PAGE,
    before,
  }: {
    timezone?: string
    range?: LocalRange
    order?: 'asc' | 'desc'
    limit?: number
    before?: TurnCursor
  } = {},
): Promise<{ turns: TurnRow[]; more: boolean }> => {
  const rows = await tx<RawTurn[]>`
    select ${TURN_COLUMNS(tx)}
      from turn_costs cost
      join turns turn on turn.id = cost.turn_id
      left join projects project on project.id = turn.project_id
     where cost.org_id = ${orgId}
       and turn.org_id = ${orgId}
       ${WITHIN(tx, timezone, range)}
       ${MATCHING(tx, filter)}
       ${PAST(tx, order, before)}
     order by ${
       order === 'asc'
         ? tx`turn.occurred_at asc, turn.id asc`
         : tx`turn.occurred_at desc, turn.id desc`
     }
     limit ${limit + 1}
  `

  return { turns: rows.slice(0, limit).map(asRow), more: rows.length > limit }
}

/**
 * The period, on both sides of the join.
 *
 * Both carry the qual so each reaches `turns_org_occurred_at_idx`, which is
 * the same reason `breakdown` writes it twice: `turn_costs` is a plain join
 * over `turns` since ticket 81, and the planner bounds both scans rather than
 * pricing the deployment and discarding it.
 */
const WITHIN = (
  tx: TransactionSql,
  timezone: string | undefined,
  range: LocalRange | undefined,
) => {
  if (!range || !timezone) return tx``
  const from = tx`(${range.from}::date)::timestamp at time zone ${timezone}`
  const to = tx`(${range.to}::date)::timestamp at time zone ${timezone}`
  return tx`and cost.occurred_at >= ${from} and cost.occurred_at < ${to}
            and turn.occurred_at >= ${from} and turn.occurred_at < ${to}`
}

/**
 * The cut, as equality on an indexed column.
 *
 * `is null` rather than `is not distinct from $1` for the absent group: the
 * two mean the same thing and only the first can use an index, and "no Project
 * reported" on a large Org is exactly the group big enough to need one.
 */
const MATCHING = (tx: TransactionSql, filter: TurnFilter) => {
  switch (filter.kind) {
    case 'members':
      return tx`and turn.member_id = ${filter.id}`
    case 'projects':
      return filter.id === null
        ? tx`and turn.project_id is null`
        : tx`and turn.project_id = ${filter.id}`
    case 'devices':
      return filter.id === null
        ? tx`and turn.device_id is null`
        : tx`and turn.device_id = ${filter.id}`
    default:
      // Both columns, because `turns_identity_key` leads on `member_id`: a
      // session id on its own has no index behind it and would be a scan.
      return tx`and turn.member_id = ${filter.memberId}
                and turn.session_id = ${filter.sessionId}`
  }
}

/** The keyset cursor, in whichever direction the list is reading. */
const PAST = (
  tx: TransactionSql,
  order: 'asc' | 'desc',
  before: TurnCursor | undefined,
) =>
  before
    ? order === 'asc'
      ? tx`and (turn.occurred_at, turn.id) > (${before.occurredAt}::timestamptz, ${before.id}::bigint)`
      : tx`and (turn.occurred_at, turn.id) < (${before.occurredAt}::timestamptz, ${before.id}::bigint)`
    : tx``

// --- One Turn, quantity by quantity (ticket 88) -------------------------

/**
 * One line of a Turn's breakdown.
 *
 * `quantity` is what the Turn reported, `rateUsd` the Rate that priced it and
 * `costUsd` what that came to. `unpriced` is true when the Turn consumed some
 * of this and no Rate matched — and then `costUsd` is null rather than zero,
 * which is ADR 0002's rule and the one ticket 42 had to fix once already.
 *
 * `note` carries the one thing a number cannot say: that thinking tokens are
 * already inside output, or that a reported cache-write total exceeds its
 * split and the remainder is therefore priced by nothing.
 */
export type Quantity = {
  key: string
  label: string
  /** `per_mtok` or `per_krequests`, which is what the Rate is quoted in. */
  unit: 'per_mtok' | 'per_krequests'
  quantity: number
  rateUsd: number | null
  costUsd: number | null
  unpriced: boolean
  note: string | null
}

export type TurnDetail = {
  row: TurnRow
  /** Every dimension the Turn recorded, for the header beside the figures. */
  facts: {
    serviceTier: string | null
    speed: string | null
    inferenceGeo: string | null
    clientVersion: string | null
    spawnDepth: number | null
    cloudSessionHandle: string | null
    /** What Claude Code itself reported, when it reported one. Shown beside
     * our own estimate rather than instead of it: they are two different
     * claims and a reader comparing them is the point. */
    reportedCostUsd: number | null
    /** The three modifiers, as one number (ADR 0002). 1 when none applied. */
    multiplier: number
    /** The date the Rates were resolved on, in the Org's timezone. */
    pricedOn: string
    memberId: string
    memberEmail: string | null
    deviceLabel: string | null
  }
  quantities: Quantity[]
}

type RawDetail = RawTurn & {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  cache_creation_5m_input_tokens: number
  cache_creation_1h_input_tokens: number
  thinking_tokens: number
  web_search_requests: number
  web_fetch_requests: number
  service_tier: string | null
  speed: string | null
  inference_geo: string | null
  client_version: string | null
  spawn_depth: number | null
  cloud_session_handle: string | null
  reported_cost_usd: string | null
  member_id: string
  member_email: string | null
  device_label: string | null
  multiplier: string
  priced_on: string
  input_usd: string | null
  output_usd: string | null
  cache_read_usd: string | null
  cache_write_5m_usd: string | null
  cache_write_1h_usd: string | null
  web_search_usd: string | null
  web_fetch_usd: string | null
}

const number = (value: string | null) => (value === null ? null : Number(value))

/**
 * One Turn and the seven Rates that priced it, or null when the viewer may not
 * read it — which `turns_read` decides, so this statement filters on the id
 * and on nothing else. A Turn outside the viewer's set is no row, which the
 * page answers as a 404: a distinguishable refusal would confirm that a Turn
 * somebody cannot see exists.
 *
 * The Rates come from `sessclone_resolve_rate`, which is the definition of
 * record for the precedence rule — an Org override beats the platform table, a
 * row naming the model beats a model-independent one, and the latest
 * `effective_from` on or before the date settles the rest. Seven calls for one
 * Turn, which is cheap and, more to the point, is not a second copy of that
 * rule: a copy here is exactly the drift ADR 0002 spent its length avoiding.
 *
 * The per-class arithmetic is spelled the way `turn_costs` spells it —
 * `quantity * price * multiplier / 1000000`, in that order — because `sum(q *
 * p * m / 1e6)` and `sum(q * p * m) / 1e6` are not the same numeric.
 * `turns.test.ts` fails if the lines here stop summing to the view's own
 * `cost_usd`.
 */
export const turnDetail = async (
  tx: TransactionSql,
  orgId: string,
  turnId: string,
): Promise<TurnDetail | null> => {
  const [row] = await tx<RawDetail[]>`
    select ${TURN_COLUMNS(tx)},
           turn.input_tokens, turn.output_tokens, turn.cache_read_input_tokens,
           turn.cache_creation_input_tokens,
           turn.cache_creation_5m_input_tokens,
           turn.cache_creation_1h_input_tokens,
           turn.thinking_tokens, turn.web_search_requests,
           turn.web_fetch_requests,
           turn.service_tier, turn.speed, turn.inference_geo,
           turn.client_version, turn.spawn_depth, turn.cloud_session_handle,
           turn.reported_cost_usd,
           turn.member_id::text as member_id,
           account.email as member_email,
           coalesce(device.nickname, device.key) as device_label,
           day.multiplier,
           day.on_date::text as priced_on,
           sessclone_resolve_rate(turn.org_id, turn.model, 'input', day.on_date)
             as input_usd,
           sessclone_resolve_rate(turn.org_id, turn.model, 'output', day.on_date)
             as output_usd,
           sessclone_resolve_rate(turn.org_id, turn.model, 'cache_read', day.on_date)
             as cache_read_usd,
           sessclone_resolve_rate(turn.org_id, turn.model, 'cache_write_5m', day.on_date)
             as cache_write_5m_usd,
           sessclone_resolve_rate(turn.org_id, turn.model, 'cache_write_1h', day.on_date)
             as cache_write_1h_usd,
           sessclone_resolve_rate(turn.org_id, turn.model, 'web_search_request', day.on_date)
             as web_search_usd,
           sessclone_resolve_rate(turn.org_id, turn.model, 'web_fetch_request', day.on_date)
             as web_fetch_usd
      from turn_costs cost
      join turns turn on turn.id = cost.turn_id
      left join projects project on project.id = turn.project_id
      left join members member on member.id = turn.member_id
      left join users account on account.id = member.user_id
      left join devices device on device.id = turn.device_id
      -- The Org's own timezone decides which day a Rate is read on, exactly
      -- as turn_costs reads it (ticket 51). A left join and a coalesce, so a
      -- Turn whose Org row is unreadable prices in UTC rather than vanishing.
      left join orgs org on org.id = turn.org_id
      cross join lateral (
        select (turn.occurred_at at time zone coalesce(org.timezone, 'UTC'))::date
                 as on_date,
               sessclone_price_multiplier(
                 turn.model, turn.speed, turn.inference_geo, turn.service_tier
               ) as multiplier
      ) as day
     where turn.id = ${turnId}::bigint
       and turn.org_id = ${orgId}
  `

  if (!row) return null

  const multiplier = Number(row.multiplier)
  // The remainder of a reported cache-write total that the 5m/1h split does
  // not account for. `packages/shared/src/turns.ts` allows a capture to state
  // the total and no split, and pricing the shortfall at the 5m rate would be
  // a guess — so it is its own line, and an unpriced one.
  const unsplit = Math.max(
    0,
    row.cache_creation_input_tokens -
      row.cache_creation_5m_input_tokens -
      row.cache_creation_1h_input_tokens,
  )

  return {
    row: asRow(row),
    facts: {
      serviceTier: row.service_tier,
      speed: row.speed,
      inferenceGeo: row.inference_geo,
      clientVersion: row.client_version,
      spawnDepth: row.spawn_depth,
      cloudSessionHandle: row.cloud_session_handle,
      reportedCostUsd: number(row.reported_cost_usd),
      multiplier,
      pricedOn: row.priced_on,
      memberId: row.member_id,
      memberEmail: row.member_email,
      deviceLabel: row.device_label,
    },
    quantities: [
      tokens('input', 'Input', row.input_tokens, row.input_usd, multiplier),
      tokens('output', 'Output', row.output_tokens, row.output_usd, multiplier),
      {
        // A subset of output rather than an addition to it, which the schema
        // says and a reader adding the column up would otherwise get wrong.
        ...tokens(
          'thinking',
          'Thinking',
          row.thinking_tokens,
          null,
          multiplier,
        ),
        rateUsd: null,
        costUsd: null,
        unpriced: false,
        note: 'already counted inside output',
      },
      tokens(
        'cache_read',
        'Cache read',
        row.cache_read_input_tokens,
        row.cache_read_usd,
        multiplier,
      ),
      tokens(
        'cache_write_5m',
        'Cache write, 5m',
        row.cache_creation_5m_input_tokens,
        row.cache_write_5m_usd,
        multiplier,
      ),
      tokens(
        'cache_write_1h',
        'Cache write, 1h',
        row.cache_creation_1h_input_tokens,
        row.cache_write_1h_usd,
        multiplier,
      ),
      ...(unsplit > 0
        ? [
            {
              key: 'cache_write_unsplit',
              label: 'Cache write, no split reported',
              unit: 'per_mtok' as const,
              quantity: unsplit,
              rateUsd: null,
              costUsd: null,
              unpriced: true,
              note: 'reported as a total with no 5m or 1h split, so no Rate applies',
            },
          ]
        : []),
      // The two server-tool classes are quoted per thousand requests and are
      // model-independent, and none of the three modifiers touches them: a web
      // search published at $10.00 per 1,000 costs $10.00 on fast mode too.
      requests(
        'web_search',
        'Web searches',
        row.web_search_requests,
        row.web_search_usd,
      ),
      requests(
        'web_fetch',
        'Web fetches',
        row.web_fetch_requests,
        row.web_fetch_usd,
      ),
    ],
  }
}

/** A token class: priced per million, and multiplied by the three modifiers. */
const tokens = (
  key: string,
  label: string,
  quantity: number,
  rate: string | null,
  multiplier: number,
): Quantity => {
  const rateUsd = number(rate)
  return {
    key,
    label,
    unit: 'per_mtok',
    quantity,
    rateUsd,
    // A class the Turn consumed nothing of is not a gap: it contributes
    // nothing either way, so it reads as zero rather than as unpriced.
    costUsd:
      quantity === 0
        ? 0
        : rateUsd === null
          ? null
          : (quantity * rateUsd * multiplier) / 1_000_000,
    unpriced: quantity > 0 && rateUsd === null,
    note: null,
  }
}

/** A server-tool class: priced per thousand, and no modifier applies. */
const requests = (
  key: string,
  label: string,
  quantity: number,
  rate: string | null,
): Quantity => {
  const rateUsd = number(rate)
  return {
    key,
    label,
    unit: 'per_krequests',
    quantity,
    rateUsd,
    costUsd:
      quantity === 0
        ? 0
        : rateUsd === null
          ? null
          : (quantity * rateUsd) / 1_000,
    unpriced: quantity > 0 && rateUsd === null,
    note: null,
  }
}
