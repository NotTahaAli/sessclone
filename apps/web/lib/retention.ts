import type postgres from 'postgres'

import { onceMoreOnRace } from './artifacts'
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

/**
 * How long an Org that moved to a Tier without transcripts keeps the ones it
 * has (ticket 139, Taha: seven days). Uploads stop at once.
 */
export const DOWNGRADE_GRACE_DAYS = 7

/**
 * When the sweep takes the active Org's stored transcripts because its Tier
 * keeps none (ticket 139): the last Tier change plus the grace, the same
 * reading `CUTOFFS` makes below. Null while the Tier keeps transcripts.
 */
export const transcriptsEndOn = async (
  tx: postgres.TransactionSql,
  orgId: string,
): Promise<{ on: Date; passed: boolean } | null> => {
  const [row] = await tx<{ ends: Date | null; passed: boolean }[]>`
    select ends, ends <= now() as passed
      from subscriptions subscription
      join tiers tier on tier.id = subscription.tier_id
     cross join lateral (
       select max(event.occurred_at)
              + ${`${DOWNGRADE_GRACE_DAYS} days`}::interval as ends
         from subscription_events event
        where event.org_id = subscription.org_id
     ) grace
     where subscription.org_id = ${orgId}
       and tier.archival_available is false
  `
  return row?.ends ? { on: row.ends, passed: row.passed } : null
}

export type Swept = {
  /** Artifact rows removed. Their chunks (ADR 0008) went too, uncounted. */
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
         case
           -- Ticket 139: a Tier with no transcripts (Personal) keeps an Org's
           -- existing ones for DOWNGRADE_GRACE_DAYS after its last
           -- subscription change, then all of them go. Zero days is "every
           -- transcript stored before now".
           when tier.archival_available is false
            and coalesce((select max(event.occurred_at)
                            from subscription_events event
                           where event.org_id = org.id),
                         '-infinity') < now() - ${`${DOWNGRADE_GRACE_DAYS} days`}::interval
             then 0
           -- least() ignores nulls, so no ceiling needs no coalesce. The
           -- Org's own contract ceiling (ticket 139) comes before the Tier's.
           else least(org.retention_days,
                      coalesce(subscription.retention_max_days,
                               tier.retention_max_days))
         end as days
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
    // One sweep at a time on the deployment. Two overlapping sweeps cannot
    // delete one object twice — `delete` re-checks each row — but the second
    // one's `doomed` is chosen from a snapshot that still shows the first
    // one's rows, so it deletes fewer than it selected, reads that as "no
    // more" and stops a drain with a backlog left. The lock is held for the
    // transaction, so a second caller is told to come back rather than
    // queueing behind a bucket round trip.
    const [held] = await tx<{ granted: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtext('sessclone_retention_sweep'))
             as granted
    `
    if (!held?.granted) return { removed: 0, more: true }

    // One statement across the deployment, oldest first. The filter compares
    // each artifact against its own Org's cutoff, which is a joined value —
    // and with `log_artifacts_org_created_at_idx` in place and the table
    // analysed, the planner drives it as a nested loop from `orgs` and turns
    // that comparison into the index condition. Measured on one box at 200k
    // artifacts across 50 Orgs: 0.5ms with nothing expired, 65ms with 120k
    // expired (a parallel scan, once the backlog is large enough to be worth
    // one). A per-Org `cross join lateral` was tried and is worse — 220ms on
    // the same backlog, because it fetches `limit` rows per Org and sorts the
    // union of them single-threaded.
    //
    // An expired transcript takes its sidecars with it (ticket 104) whatever
    // their own age — a run's `.meta.json` and a workflow's journal are
    // written after the transcript they describe and must not outlive it.
    // Found by the identity key's leading `(member_id, session_id)`, in the
    // same statement.
    // Once more on a 23503: a confirm sealing an expired transcript as it
    // goes (see `onceMoreOnRace`).
    const rows = await onceMoreOnRace(
      tx,
      (sp) => sp<
        { storage_key: string; expired: boolean; artifact: boolean }[]
      >`
      with cutoffs as (${CUTOFFS(sp)}), expired as (
        select artifact.id, artifact.member_id, artifact.session_id,
               artifact.agent_id, artifact.kind
          from log_artifacts artifact
          join cutoffs on cutoffs.org_id = artifact.org_id
         where artifact.created_at
               < now() - (cutoffs.days || ' days')::interval
         -- Oldest first, so a backlog drains in the order things expired.
         order by artifact.created_at
         limit ${limit}
      ), doomed as (
        select id from expired
        union
        select sidecar.id
          from expired transcript
          join log_artifacts sidecar
            on sidecar.member_id = transcript.member_id
           and sidecar.session_id = transcript.session_id
         where transcript.kind = 'transcript'
           and (sidecar.kind = 'agent_meta'
                  and sidecar.agent_id = transcript.agent_id
                or sidecar.kind = 'workflow_journal'
                  and transcript.agent_id is null)
      ), chunks as (
        -- ADR 0008: a transcript's chunks go in the same statement as the
        -- transcript, and their keys with it. The foreign key is no action,
        -- so forgetting this fails the sweep rather than orphaning them.
        delete from log_artifact_chunks
         where artifact_id in (select id from doomed)
        returning storage_key
      ), artifacts as (
        delete from log_artifacts
         where id in (select id from doomed)
        returning storage_key, id in (select id from expired) as expired
      )
      select storage_key, expired, true as artifact from artifacts
      union all
      select storage_key, false, false from chunks
    `,
    )
    const expired = rows.filter((row) => row.expired).length
    const removed = rows.filter((row) => row.artifact).length

    // ADR 0008: keys a presign signed that no confirm recorded before they
    // expired — a pass cut off, crashed, or whose confirm never came. They
    // join the orphans below, which deletes each once no row names it. A
    // confirm arriving now waits on these rows and is then refused.
    //
    // Counted by the ledger rows deleted, not the orphans inserted: a key
    // already queued is skipped by the insert, and a full batch counted short
    // would report no backlog.
    const [lapsed] = await tx<{ count: number }[]>`
      with lapsed as (
        delete from log_upload_pending
         where storage_key in (
           select storage_key from log_upload_pending
            where expires_at < now()
            order by expires_at limit ${limit}
         )
        returning storage_key
      ), queued as (
        insert into storage_orphans (storage_key)
        select storage_key from lapsed
        on conflict (storage_key) do nothing
      )
      select count(*)::int as count from lapsed
    `

    // The objects nothing names any more (`storage_orphans`), taken in the
    // same batch: they are already paid for in one round trip, and they are
    // the one class of stored transcript no row can lead anybody to.
    //
    // Only while no row names the key again, and no presign has signed it
    // again: the whole-file key is reused by every zero-chunk pass, so a key
    // queued here can be live once more. All three lookups are unique
    // indexes. Such a key stays queued, and goes once it is an orphan again.
    const orphans = await tx<{ storage_key: string }[]>`
      delete from storage_orphans
       where storage_key in (
         select orphan.storage_key from storage_orphans orphan
          where not exists (select 1 from log_artifacts artifact
                             where artifact.storage_key = orphan.storage_key)
            and not exists (select 1 from log_artifact_chunks chunk
                             where chunk.storage_key = orphan.storage_key)
            and not exists (select 1 from log_upload_pending pending
                             where pending.storage_key = orphan.storage_key)
            -- A key taken from the ledger unrecorded waits out its URL.
            and orphan.not_before <= now()
          order by orphan.noticed_at limit ${limit}
       )
      returning storage_key
    `

    const keys = [...rows, ...orphans].map((row) => row.storage_key)
    if (keys.length > 0) await deleteObjects(keys)

    // Recorded even when it removed nothing, because "has a sweep ever run
    // here" is the question the settings page needs answered — a deployment
    // with no scheduler promises a window it never enforces.
    await tx`
      insert into retention_sweeps (swept_at, removed)
      values (now(), ${removed})
      on conflict (id) do update
         set swept_at = excluded.swept_at, removed = excluded.removed
    `

    // At the limit means there may be more; the caller calls again. Saying
    // "more" when the backlog happened to end exactly on the limit costs one
    // extra call that removes nothing, which is the cheap way to be wrong.
    return {
      removed,
      more:
        expired === limit ||
        orphans.length === limit ||
        lapsed!.count === limit,
    }
  })

/**
 * How many artifacts are past their window right now.
 *
 * Measured from `created_at`, which is written once: `uploaded_at` moves every
 * time a growing Session replaces its object, so a window measured from it
 * would be days since the last upload rather than days since the transcript
 * was stored.
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
     where artifact.created_at < now() - (cutoffs.days || ' days')::interval
  `
  return Number(row?.count ?? 0)
}
