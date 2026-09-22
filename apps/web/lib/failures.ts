import type { TransactionSql } from 'postgres'

import type { LocalRange } from './series'

// Ticket 78: why a Session failed. Ticket 40 records a `stop_failure` against
// the Session — the API error a turn ended on, its message, when it fired —
// and until now nothing read it, so a Collector that stopped reporting looked
// like a quiet week.
//
// The read is the failures view's, and it is the same shape as `breakdown`:
// one Org, one range in the Org's timezone, names fetched with `left` joins.
//
// Nothing here scopes by Role. `session_events_read` does (ADR 0001), the same
// `sessclone_visible_member_ids()` policy `turns_read` uses: an Owner and an
// Admin see the Org, a Manager their Scope, a Member themselves. A page that
// filtered too would be a second answer to a question the database already
// answers, and the one that goes stale.
//
// The name joins are `left` for the reason `breakdown` gives: `devices_read`
// and `members_read` are not `session_events_read`, so a failure the viewer
// may see whose Device or Member row they may not would vanish from an inner
// join — turning a leak-proof policy into a silent undercount of failures,
// which on the surface that answers "why did nothing arrive" is the worse
// failure. An unreadable name comes back null and is labelled rather than
// dropped.

/**
 * How many failures one page shows. A busy Org in a rate-limit storm can log
 * a great many, so the read is capped and the surface says how many it left
 * out — the same treatment `breakdown` gives an unbounded list.
 */
export const FAILURES_LIMIT = 100

export type FailureRow = {
  /** `session_events.id`, stable per row and the React key. */
  id: string
  /** ISO 8601, in UTC: the surface formats it in the reader's locale. */
  occurredAt: string
  sessionId: string
  /** Null for a main Session; set when the failure was in an Agent Run. */
  agentId: string | null
  errorType: string
  /** What Claude Code reported, as recorded. Null when it reported none. */
  message: string | null
  /** The Device's nickname or key, or null when it is not the viewer's to see
   * or the failure named no Device. */
  device: string | null
  /** The Member's email, or null when it is not the viewer's to see. */
  member: string | null
}

export type Failures = {
  rows: FailureRow[]
  /** Every failure in the range, not only the page's worth. */
  total: number
  /** How many fell past the cap, or zero. */
  more: number
}

type RawRow = {
  id: string
  occurred_at: Date
  session_id: string
  agent_id: string | null
  error_type: string
  message: string | null
  device: string | null
  member: string | null
  total: string
}

const bounds = (tx: TransactionSql, timezone: string, range: LocalRange) => ({
  from: tx`(${range.from}::date)::timestamp at time zone ${timezone}`,
  to: tx`(${range.to}::date)::timestamp at time zone ${timezone}`,
})

/**
 * The stop failures for one Org over a range, newest first.
 *
 * `count(*) over ()` carries the full total on every row, so the cap and the
 * "and N more" both come from one statement rather than a second `count` that
 * could disagree with the list under a concurrent insert.
 */
export const sessionFailures = async (
  tx: TransactionSql,
  orgId: string,
  timezone: string,
  range: LocalRange,
): Promise<Failures> => {
  const { from, to } = bounds(tx, timezone, range)

  const rows = await tx<RawRow[]>`
    select event.id::text as id,
           event.occurred_at,
           event.session_id,
           event.agent_id,
           coalesce(event.detail->>'error_type', 'unknown') as error_type,
           event.detail->>'message' as message,
           coalesce(device.nickname, device.key) as device,
           coalesce(account.display_name, account.email) as member,
           count(*) over () as total
      from session_events event
      left join devices device on device.id = event.device_id
      left join members member on member.id = event.member_id
      left join users account on account.id = member.user_id
     where event.org_id = ${orgId}
       and event.kind = 'stop_failure'
       and event.occurred_at >= ${from}
       and event.occurred_at < ${to}
     order by event.occurred_at desc, event.id desc
     limit ${FAILURES_LIMIT}
  `

  const total = rows[0] ? Number(rows[0].total) : 0

  return {
    rows: rows.map((row) => ({
      id: row.id,
      occurredAt: row.occurred_at.toISOString(),
      sessionId: row.session_id,
      agentId: row.agent_id,
      errorType: row.error_type,
      message: row.message,
      device: row.device,
      member: row.member,
    })),
    total,
    more: Math.max(0, total - FAILURES_LIMIT),
  }
}

/**
 * How many failures the range holds, for the tab's count badge.
 *
 * Its own statement rather than a side effect of `sessionFailures`, because
 * the badge is shown on every Costs view — a reader on the spend chart still
 * sees "Failures 3" — and only the failures view itself reads the rows.
 * Index-backed by `session_events_failure_idx` (ticket 78's migration).
 */
export const countFailures = async (
  tx: TransactionSql,
  orgId: string,
  timezone: string,
  range: LocalRange,
): Promise<number> => {
  const { from, to } = bounds(tx, timezone, range)

  const [row] = await tx<{ count: string }[]>`
    select count(*) as count
      from session_events event
     where event.org_id = ${orgId}
       and event.kind = 'stop_failure'
       and event.occurred_at >= ${from}
       and event.occurred_at < ${to}
  `
  return Number(row?.count ?? 0)
}
