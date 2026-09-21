import { cacheTag } from 'next/cache'
import type { TransactionSql } from 'postgres'

import { asAnyone } from './db'

/**
 * The Tiers the public pages render, read from the `tiers` table.
 *
 * Ticket 80. These were four literals in this module — the prices settled on
 * 2026-09-20 — which made the page a second source of truth beside the table
 * the admin page edits, and the one that silently went stale. The seed
 * migration `…_tier_seed.sql` put the same numbers in the table; this reads
 * them, and a price change on `/admin/tiers` is live on the next request with
 * no deployment.
 *
 * Every field is a column with the same name and meaning: `seatPriceUsd` and
 * `basePriceUsd` both null mean "contact us" — a real Tier, not a missing
 * value — null `maxSeats` means no limit, and null `retentionMaxDays` means no
 * ceiling. `includes` is `features.includes`, the card's prose, which is data
 * for the reason ADR 0004 gives: a Tier that starts including something new is
 * an edit, not a deploy.
 */
export type MarketingTier = {
  key: string
  name: string
  description: string
  /** A flat monthly price, independent of seats. */
  basePriceUsd: number | null
  /** Per seat per month. A seat is a person, not a machine. */
  seatPriceUsd: number | null
  minSeats: number | null
  maxSeats: number | null
  retentionMaxDays: number | null
  archivalAvailable: boolean
  /** What the card lists. Prose, in the reader's terms. */
  includes: string[]
  sortOrder: number
}

/**
 * The rows, unwrapped, so a test can read them without a Next cache scope.
 *
 * Only `available` Tiers: one withdrawn from sale still prices the Orgs on it
 * (ticket 47) and must not be sold to somebody new.
 */
export const readMarketingTiers = async (
  tx: TransactionSql,
): Promise<MarketingTier[]> => {
  const rows = await tx<TierRow[]>`
    select key, name, description, base_price_usd, seat_price_usd,
           min_seats, max_seats, retention_max_days, archival_available,
           features, sort_order
      from tiers
     where available
     order by sort_order, name
  `

  return rows.map((row) => ({
    key: row.key,
    name: row.name,
    description: row.description ?? '',
    // `numeric` arrives as a string, and `Number(null)` is 0 — which is the
    // difference between "contact us" and "free" on a pricing page.
    basePriceUsd: row.base_price_usd === null ? null : Number(row.base_price_usd),
    seatPriceUsd: row.seat_price_usd === null ? null : Number(row.seat_price_usd),
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
    retentionMaxDays: row.retention_max_days,
    archivalAvailable: row.archival_available,
    includes: includesOf(row.features),
    sortOrder: row.sort_order,
  }))
}

/** `features.includes`, when it is a list of lines, and nothing otherwise. */
const includesOf = (features: unknown) => {
  const value =
    features && typeof features === 'object'
      ? (features as Record<string, unknown>).includes
      : undefined
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === 'string')
    : []
}

type TierRow = {
  key: string
  name: string
  description: string | null
  base_price_usd: string | null
  seat_price_usd: string | null
  min_seats: number | null
  max_seats: number | null
  retention_max_days: number | null
  archival_available: boolean
  features: unknown
  sort_order: number
}

/**
 * The same rows, cached until somebody changes a Tier.
 *
 * `'use cache'` because a public page that opens a connection per visitor
 * spends a database on copy that changes a few times a year, and
 * `cacheTag('tiers')` because the admin save is what makes it stale: that
 * action calls `updateTag('tiers')`, so the next request renders the new
 * price rather than waiting for a revalidation window.
 */
export const marketingTiers = async (): Promise<MarketingTier[]> => {
  'use cache'
  cacheTag(TIERS_TAG)
  return asAnyone(readMarketingTiers)
}

/** The one tag name, so the read and the two invalidators cannot drift. */
export const TIERS_TAG = 'tiers'

/**
 * The four fields the two helpers below read, named as a type so the Owner's
 * Tier page (ticket 47) can pass a row it read from `tiers` rather than a
 * `MarketingTier`. One spelling of "what does this Tier cost", used by the
 * marketing card and by the Org's own page — the alternative is two, and the
 * second one is the one that says Free where the first says Contact.
 */
export type TierPricing = Pick<
  MarketingTier,
  'basePriceUsd' | 'seatPriceUsd' | 'minSeats' | 'maxSeats'
>

/**
 * What a card puts where the price goes. A Tier with neither price is
 * "Contact" rather than free — the failure ticket 80 names explicitly, and
 * the one that costs the most when it happens.
 */
export const tierPrice = (
  tier: TierPricing,
): { amount: string; unit: string | null } => {
  if (tier.seatPriceUsd !== null && tier.seatPriceUsd > 0) {
    return { amount: `$${tier.seatPriceUsd}`, unit: 'per seat / month' }
  }
  if (tier.basePriceUsd !== null && tier.basePriceUsd > 0) {
    return { amount: `$${tier.basePriceUsd}`, unit: 'per month' }
  }
  if (tier.basePriceUsd === null && tier.seatPriceUsd === null) {
    return { amount: 'Contact', unit: null }
  }
  return { amount: 'Free', unit: 'at any size' }
}

/** The seat allowance, in a sentence rather than as two numbers. */
export const tierSeats = (tier: TierPricing): string => {
  if (tier.maxSeats === 1) return 'One person, no seat management'
  if (tier.maxSeats === null) {
    return tier.minSeats === null ? 'No seat limit' : `${tier.minSeats} and up`
  }
  return `${tier.minSeats ?? 1} to ${tier.maxSeats} seats`
}
