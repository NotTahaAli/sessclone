import type { TransactionSql } from 'postgres'

import type { SubscriptionStatus } from './tier'

// Ticket 48: activation by hand, and the record it leaves.
//
// v1 ships no payment rail (ADR 0004), so an Org becomes active because the
// operator says it has — after a bank transfer, an invoice, or an agreement
// that never touched this system at all. The thing that makes that safe to
// live with is the audit trail, and the audit trail is not this module's to
// remember: `sessclone_write_subscription_event` is a trigger on
// `subscriptions`, so an event lands whether the row was written here, by a
// provider's webhook later, or by hand in psql.
//
// What this module adds is the one part the database cannot know — why. The
// note travels on a transaction-local setting read by that trigger, set in the
// same transaction as the write, so a note can never be attached to an event
// that did not happen.
//
// Nothing here is provider-specific and nothing checks a Tier key. Entitlement
// is `status` plus the `tiers` row (ADR 0004, and `lib/tier.ts`), which is why
// a Stripe webhook arriving in v2 writes these same two columns and the
// history before and after reads as one series.

export const ORG_PAGE = 50

/** How many events one Org's history shows; the page says so when it is cut. */
export const HISTORY_PAGE = 20

export type AdminOrg = {
  id: string
  name: string
  createdAt: Date
  seats: number
  /** Null when the Org has no subscription row: real, and not an error. */
  tierId: string | null
  tierKey: string | null
  tierName: string | null
  status: SubscriptionStatus | null
  currentPeriodEnd: Date | null
}

type OrgRow = {
  id: string
  name: string
  created_at: Date
  seats: string
  tier_id: string | null
  tier_key: string | null
  tier_name: string | null
  status: SubscriptionStatus | null
  current_period_end: Date | null
}

/**
 * Every Org in the deployment, newest first, with what it is on.
 *
 * One statement, not one per Org: the Seat count is a lateral aggregate and
 * the Tier a left join, because a page that lists Orgs and then asks about
 * each one is the query-in-a-loop AGENTS.md calls a bug.
 *
 * The name filter is a URL on the page, because the list is capped and sorted
 * newest-first: without it the Org that has been waiting on activation the
 * longest is the first one to fall off the end.
 *
 * `orgs_read` is what makes this the operator's list — it returns an Org the
 * caller is a Member of, or every Org when they are a Platform Admin — so this
 * is not an admin-only query with an admin-only name, it is the same statement
 * every caller may run and be given what is theirs.
 */
export const listOrgs = async (
  tx: TransactionSql,
  options: { name?: string | null; limit?: number } = {},
): Promise<{ orgs: AdminOrg[]; more: boolean }> => {
  const { name = null, limit = ORG_PAGE } = options
  const rows = await tx<OrgRow[]>`
    select org.id,
           org.name,
           org.created_at,
           seats.count as seats,
           tier.id as tier_id,
           tier.key as tier_key,
           tier.name as tier_name,
           subscription.status,
           subscription.current_period_end
      from orgs org
      left join subscriptions subscription on subscription.org_id = org.id
      left join tiers tier on tier.id = subscription.tier_id
      left join lateral (
        select count(*) from members
         where members.org_id = org.id and members.removed_at is null
      ) seats on true
     ${name ? tx`where org.name ilike ${`%${name}%`}` : tx``}
     order by org.created_at desc
     limit ${limit + 1}
  `

  return {
    orgs: rows.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      seats: Number(row.seats),
      tierId: row.tier_id,
      tierKey: row.tier_key,
      tierName: row.tier_name,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
    })),
    more: rows.length > limit,
  }
}

/**
 * One Org, in the same shape the list returns.
 *
 * A page that shows one Org reads one row: pulling the list and finding the id
 * in it is a table scan for a primary-key lookup, and it silently stops
 * working once the list is longer than whatever limit it passed.
 */
export const adminOrg = async (
  tx: TransactionSql,
  orgId: string,
): Promise<AdminOrg | null> => {
  const [row] = await tx<OrgRow[]>`
    select org.id,
           org.name,
           org.created_at,
           seats.count as seats,
           tier.id as tier_id,
           tier.key as tier_key,
           tier.name as tier_name,
           subscription.status,
           subscription.current_period_end
      from orgs org
      left join subscriptions subscription on subscription.org_id = org.id
      left join tiers tier on tier.id = subscription.tier_id
      left join lateral (
        select count(*) from members
         where members.org_id = org.id and members.removed_at is null
      ) seats on true
     where org.id = ${orgId}
  `

  if (!row) return null

  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    seats: Number(row.seats),
    tierId: row.tier_id,
    tierKey: row.tier_key,
    tierName: row.tier_name,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
  }
}

export type SubscriptionEvent = {
  id: string
  status: SubscriptionStatus
  tierName: string
  note: string | null
  actorEmail: string | null
  provider: string
  occurredAt: Date
}

/**
 * What has happened to one Org's subscription, newest first.
 *
 * Backed by `subscription_events_org_idx`, and bounded like every other list.
 * The actor is joined rather than stored as a name: a person's address changes
 * and the history should read as it is now, while the event itself stays
 * exactly as it was written.
 */
export const subscriptionHistory = async (
  tx: TransactionSql,
  orgId: string,
  limit = HISTORY_PAGE,
): Promise<SubscriptionEvent[]> => {
  const rows = await tx<
    {
      id: string
      status: SubscriptionStatus
      tier_name: string
      note: string | null
      actor_email: string | null
      provider: string
      occurred_at: Date
    }[]
  >`
    select event.id::text as id,
           event.status,
           tier.name as tier_name,
           event.note,
           actor.email as actor_email,
           event.provider,
           event.occurred_at
      from subscription_events event
      join tiers tier on tier.id = event.tier_id
      left join users actor on actor.id = event.actor_user_id
     where event.org_id = ${orgId}
     order by event.occurred_at desc, event.id desc
     limit ${limit}
  `

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    tierName: row.tier_name,
    note: row.note,
    actorEmail: row.actor_email,
    provider: row.provider,
    occurredAt: row.occurred_at,
  }))
}

/**
 * Sets an Org's Tier and status, and records why.
 *
 * One statement for an Org that has a subscription and one that does not,
 * because activation is the same act either way and two paths is two chances
 * for one of them to skip the event.
 *
 * The note is set on the transaction first: the trigger reads it while the
 * write happens, so there is no window in which an event exists without the
 * note that explains it. `true` makes the setting transaction-local, so it
 * does not leak onto the next query this pooled connection serves.
 *
 * `provider` becomes `manual`, which is the value a v2 webhook will not use —
 * so the history says plainly which rows a person wrote by hand, including a
 * hand-made change to a row some provider created.
 *
 * `recorded` is false when the write changed neither Tier nor status:
 * `sessclone_write_subscription_event` returns early on that, so a note typed
 * beside it goes nowhere and the page must not claim it was written down.
 */
export const setSubscription = async (
  tx: TransactionSql,
  subscription: {
    orgId: string
    tierId: string
    status: SubscriptionStatus
    note: string | null
  },
): Promise<{ saved: boolean; recorded: boolean }> => {
  const [before] = await tx<{ tier_id: string; status: string }[]>`
    select tier_id, status from subscriptions
     where org_id = ${subscription.orgId}
  `

  await tx`
    select set_config('sessclone.subscription_note',
                      ${subscription.note ?? ''}, true)
  `

  const rows = await tx`
    insert into subscriptions (org_id, tier_id, status, provider)
    values (${subscription.orgId}, ${subscription.tierId},
            ${subscription.status}, 'manual')
    on conflict (org_id) do update
       set tier_id = excluded.tier_id,
           status = excluded.status,
           provider = excluded.provider,
           updated_at = now()
    returning id
  `

  // Refused by `subscriptions_write`, which is the Platform Admin flag and
  // nothing else: nothing was written, and the page says so rather than
  // claiming an activation.
  return {
    saved: rows.length > 0,
    recorded:
      rows.length > 0 &&
      (!before ||
        before.tier_id !== subscription.tierId ||
        before.status !== subscription.status),
  }
}
