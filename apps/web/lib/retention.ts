import type postgres from 'postgres'

import { deleteObjects } from './storage'

// Ticket 61: transcripts stop accumulating forever.
//
// One window per Org, in days, capped by the Tier's ceiling — the cap is the
// trigger's in `20260922100000_org_retention.sql`, and it is read again here
// because a Tier can shrink after an Org set its window and the sweep must
// not keep a transcript the Tier no longer allows.
//
// **Turns are never touched.** They are the spend history, they are
// append-only (ADR 0006), and a team that lost its cost record because a
// transcript aged out would have lost what the product is for. What ages out
// is `log_artifacts` and the objects those rows name.
//
// The sweep runs as the owning role, not as a viewer: it crosses every Org on
// the deployment, and `log_artifacts_delete` is deliberately the Member's own
// rows alone (ADR 0005 — an Admin may download a transcript and may not
// destroy it). So it is a deployment job rather than anything a browser can
// reach, and `app/api/retention/sweep/route.ts` is the only caller.

/**
 * How many artifacts one call may remove.
 *
 * A deployment that has never swept has every transcript it ever stored past
 * the window, and one statement deleting all of them is one transaction
 * holding every row it touched while the objects go in batches of a thousand.
 * Bounded instead, and the route says how many are left — a sweep is
 * idempotent, so the answer to a backlog is to call it again.
 */
export const SWEEP_LIMIT = 500

export type Swept = {
  /** Rows removed, which equals objects deleted. */
  removed: number
  /** Whether more remain past the window: call again. */
  more: boolean
}

/**
 * The effective window for each Org: its own setting, or the Tier's ceiling
 * when that is lower.
 *
 * `left join`, so an Org with no subscription keeps its own window rather than
 * dropping out of the sweep — no Tier is no ceiling here, not a ceiling of
 * zero, because the alternative is a deployment quietly deleting the
 * transcripts of every Org an operator has not activated yet.
 */
const CUTOFFS = (tx: postgres.Sql | postgres.TransactionSql) => tx`
  select org.id as org_id,
         least(org.retention_days,
               coalesce(tier.retention_max_days, org.retention_days)) as days
    from orgs org
    left join subscriptions subscription
           on subscription.org_id = org.id
          and subscription.status = 'active'
    left join tiers tier on tier.id = subscription.tier_id
`

/**
 * Removes the artifacts past their Org's window, rows and objects together.
 *
 * The order is what makes the pair atomic under failure, exactly as
 * `deleteStoredSession` has it: the rows go inside the transaction, the
 * objects go next, and the transaction commits only if that succeeded. A
 * storage failure rolls the rows back, so the deployment is left with rows
 * that can still find their bytes rather than rows pointing at nothing.
 *
 * Idempotent and safe to re-run: a second sweep finds no rows, and deleting
 * an object that is already gone succeeds — which is what makes a retried
 * call after a partial failure correct rather than dangerous.
 */
export const sweepRetention = async (
  sql: postgres.Sql,
  limit = SWEEP_LIMIT,
): Promise<Swept> =>
  sql.begin(async (tx) => {
    // Oldest first, so a backlog drains in the order things expired rather
    // than in whatever order the planner reaches them.
    const rows = await tx<{ storage_key: string }[]>`
      with cutoffs as (${CUTOFFS(tx)}), doomed as (
        select artifact.id
          from log_artifacts artifact
          join cutoffs on cutoffs.org_id = artifact.org_id
         where artifact.uploaded_at
               < now() - (cutoffs.days || ' days')::interval
         order by artifact.uploaded_at
         limit ${limit}
      )
      delete from log_artifacts
       where id in (select id from doomed)
      returning storage_key
    `

    if (rows.length === 0) return { removed: 0, more: false }

    await deleteObjects(rows.map((row) => row.storage_key))

    // At the limit means there may be more; the caller calls again. Saying
    // "more" when the backlog happened to end exactly on the limit costs one
    // extra call that removes nothing, which is the cheap way to be wrong.
    return { removed: rows.length, more: rows.length === limit }
  })

/**
 * How many artifacts are past their window right now.
 *
 * For the route's answer and for a test: a sweep that reports what it removed
 * says nothing about whether it kept up, and "is there a backlog" is the
 * question an operator actually has.
 */
export const expiredCount = async (sql: postgres.Sql): Promise<number> => {
  const [row] = await sql<{ count: string }[]>`
    with cutoffs as (${CUTOFFS(sql)})
    select count(*) as count
      from log_artifacts artifact
      join cutoffs on cutoffs.org_id = artifact.org_id
     where artifact.uploaded_at < now() - (cutoffs.days || ' days')::interval
  `
  return Number(row?.count ?? 0)
}
