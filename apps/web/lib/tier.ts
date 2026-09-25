import type { TransactionSql } from 'postgres'

import { includesOf, type TierPricing } from './tiers'

// Ticket 47: the Tier an Org is on, as the Org's Owner sees it.
//
// Every capability below is read from the `tiers` row rather than decided in
// this file, which is the ticket's last criterion: changing what a Tier
// includes is a row the operator edits (ticket 65) and not a deployment. So
// there is no map from a Tier key to a list of features here, and there must
// never be one — a key compared in code is the deployment this table exists
// to avoid.

export type SubscriptionStatus =
  'inactive' | 'active' | 'past_due' | 'cancelled'

export type OrgTier = TierPricing & {
  key: string
  name: string
  description: string | null
  status: SubscriptionStatus
  includedSeats: number
  /** The transcript retention ceiling: the Org's contract ceiling when a
   * Platform Admin set one (ticket 139), else the Tier's. Null is none. */
  retentionMaxDays: number | null
  /** Days of Turns the dashboard shows (ticket 139), or null for all. */
  historyDays: number | null
  archivalAvailable: boolean
  /** Every further gate, as ADR 0004 carries them: data, not a migration. */
  features: Record<string, unknown>
  /**
   * Seats in use. A Seat is a person and not a machine (`CONTEXT.md`), so this
   * counts Members who have not been removed rather than Devices.
   */
  seatsUsed: number
  /**
   * The ceiling the database enforces right now, from
   * `sessclone_org_seat_ceiling` itself so the page and the trigger cannot
   * disagree: null for an unapproved sign-up ask, `maxSeats` otherwise.
   */
  seatCeiling: number | null
  currentPeriodEnd: Date | null
  /** The price agreed with this Org, monthly, in US cents, or null for none
   * (a Platform Admin sets it on the admin Org page). */
  priceBaseCents: number | null
  priceSeatCents: number | null
}

type TierRow = {
  key: string
  name: string
  description: string | null
  status: SubscriptionStatus
  base_price_usd: string | null
  seat_price_usd: string | null
  included_seats: number
  min_seats: number | null
  max_seats: number | null
  retention_max_days: number | null
  history_days: number | null
  archival_available: boolean
  features: Record<string, unknown>
  seats_used: string
  seat_ceiling: number | null
  current_period_end: Date | null
  price_base_cents: number | null
  price_seat_cents: number | null
}

/**
 * The Org's Tier, or `null` when it has no subscription row at all.
 *
 * Null is a real state in v1 and not an error: there is no payment rail (ADR
 * 0004), activation is a Platform Admin's manual act (ticket 48), and a
 * brand-new Org has not had one. The page says so plainly rather than
 * inventing a default Tier, because a default Tier is an entitlement nobody
 * granted.
 *
 * Read in one round trip from `subscriptions` joined to `tiers`, which is what
 * ADR 0004 asks for: status and Tier come from one row, so an entitlement
 * check cannot read a torn pair.
 *
 * `subscriptions_read` is what decides whether the row comes back at all, and
 * the seat count is subject to `members_read` on the same connection — which
 * is exact rather than approximate for the Owner this page is for, since an
 * Owner sees every Member of their Org. It would undercount for a Role that
 * sees fewer people, which is one more reason the page is Owner-only.
 */
export const orgTier = async (
  tx: TransactionSql,
  orgId: string,
): Promise<OrgTier | null> => {
  const [row] = await tx<TierRow[]>`
    select tier.key,
           tier.name,
           tier.description,
           subscription.status,
           tier.base_price_usd,
           tier.seat_price_usd,
           tier.included_seats,
           tier.min_seats,
           tier.max_seats,
           coalesce(subscription.retention_max_days, tier.retention_max_days)
             as retention_max_days,
           tier.history_days,
           tier.archival_available,
           tier.features,
           subscription.current_period_end,
           subscription.price_base_cents,
           subscription.price_seat_cents,
           (select count(*) from members
             where members.org_id = subscription.org_id
               and members.removed_at is null) as seats_used,
           sessclone_org_seat_ceiling(subscription.org_id) as seat_ceiling
      from subscriptions subscription
      join tiers tier on tier.id = subscription.tier_id
     where subscription.org_id = ${orgId}
  `

  if (!row) return null

  return {
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status,
    // `numeric` arrives as a string, and null means something: null in both
    // price columns is "contact us", which `tierPrice` reads as Contact and a
    // `?? 0` here would turn into Free.
    basePriceUsd:
      row.base_price_usd === null ? null : Number(row.base_price_usd),
    seatPriceUsd:
      row.seat_price_usd === null ? null : Number(row.seat_price_usd),
    includedSeats: row.included_seats,
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
    retentionMaxDays: row.retention_max_days,
    historyDays: row.history_days,
    archivalAvailable: row.archival_available,
    features: row.features,
    seatsUsed: Number(row.seats_used),
    seatCeiling: row.seat_ceiling,
    currentPeriodEnd: row.current_period_end,
    priceBaseCents: row.price_base_cents,
    priceSeatCents: row.price_seat_cents,
  }
}

/** The retention ceiling in a sentence. Null is no ceiling, not zero days. */
export const retentionCeiling = (tier: OrgTier): string =>
  tier.retentionMaxDays === null
    ? 'No ceiling — keep transcripts as long as you choose'
    : `Up to ${tier.retentionMaxDays} days`

/** The history window in a sentence (ticket 139). */
export const historyWindow = (tier: OrgTier): string =>
  tier.historyDays === null
    ? 'Every Turn, however old'
    : `The last ${tier.historyDays} days`

/**
 * Whether the Org is entitled right now.
 *
 * Status and Tier together, never Tier alone: an Org on the Team Tier with a
 * cancelled subscription is on the Team Tier and entitled to nothing.
 */
export const isActive = (tier: OrgTier): boolean => tier.status === 'active'

/**
 * The flags "Also on this Tier" may name, and what it calls them. A key not
 * here is not listed: printing a raw key (`manager_scopes ✓`) is prose nobody
 * wrote, and the internal gates — `self_serve`, which Tiers a sign-up may ask
 * for, and `own_rates`, which the rates page surfaces itself — are not
 * capabilities a reader shops for. `includes` is not a flag at all: it is the
 * plan's own lines, listed as they are written.
 */
const FLAG_LABELS: Readonly<Record<string, string>> = {
  sso: 'Single sign-on',
  manager_scopes: 'Manager scopes',
}

export type Capabilities = {
  /** `features.includes`, one line each, as the operator wrote them. */
  includes: string[]
  /** Named flags that are on and not already said by an includes line. A
   * value is null for a plain on/off flag, else the setting as text. */
  flags: { label: string; value: string | null }[]
}

/**
 * What the Tier page lists under "Also on this Tier": the plan's includes
 * lines, then each named flag that is on (anything but `false` or null, so a
 * numeric setting still shows) — unless an includes line already says it,
 * which Enterprise's "Single sign-on and an invoice" does for `sso`.
 */
export const shownCapabilities = (
  features: Record<string, unknown>,
): Capabilities => {
  const includes = includesOf(features)
  const said = includes.map((line) => line.toLowerCase())
  const flags = Object.entries(features).flatMap(([key, value]) => {
    const label = FLAG_LABELS[key]
    if (!label || value === false || value === null || value === undefined) {
      return []
    }
    if (said.some((line) => line.includes(label.toLowerCase()))) return []
    return [
      {
        label,
        value:
          typeof value === 'string' || typeof value === 'number'
            ? String(value)
            : null,
      },
    ]
  })
  return { includes, flags }
}

const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)

/**
 * The price agreed with this Org, as the Tier page says it, or null when
 * none is set and the Tier's own price applies. Any Tier: an agreed price
 * is labelled for Enterprise, but one set on another Tier still wins.
 */
export const agreedPrice = (tier: {
  priceBaseCents: number | null
  priceSeatCents: number | null
}): string | null => {
  const { priceBaseCents: base, priceSeatCents: seat } = tier
  if (base === null && seat === null) return null
  if (seat === null) return `${dollars(base!)}/month`
  if (base === null) return `${dollars(seat)}/seat/month`
  return `${dollars(base)} + ${dollars(seat)}/seat/month`
}
