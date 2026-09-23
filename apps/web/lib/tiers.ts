import { cacheTag } from 'next/cache'
import type { TransactionSql } from 'postgres'

import { readAnonymously } from './db'

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
  /** `features.manager_scopes`, `features.sso` and `features.own_rates`:
   * the gates the pricing comparison marks (ticket 115). `ownRates` is null
   * when the key is absent, which is not the same as `false` (ticket 121 adds
   * it). */
  managerScopes: boolean
  sso: boolean
  ownRates: boolean | null
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
    basePriceUsd:
      row.base_price_usd === null ? null : Number(row.base_price_usd),
    seatPriceUsd:
      row.seat_price_usd === null ? null : Number(row.seat_price_usd),
    minSeats: row.min_seats,
    maxSeats: row.max_seats,
    retentionMaxDays: row.retention_max_days,
    archivalAvailable: row.archival_available,
    includes: includesOf(row.features),
    managerScopes: flagOf(row.features, 'manager_scopes') === true,
    sso: flagOf(row.features, 'sso') === true,
    ownRates: flagOf(row.features, 'own_rates'),
    sortOrder: row.sort_order,
  }))
}

/** `features.includes`, when it is a list of lines, and nothing otherwise. */
const includesOf = (features: unknown) => {
  const value =
    features && typeof features === 'object' && 'includes' in features
      ? features.includes
      : undefined
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === 'string')
    : []
}

/** A boolean key of `features`, or null when it is absent or not a boolean:
 * the column is operator-editable jsonb. */
const flagOf = (features: unknown, key: string): boolean | null => {
  const value =
    features && typeof features === 'object'
      ? Object.getOwnPropertyDescriptor(features, key)?.value
      : undefined
  return typeof value === 'boolean' ? value : null
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

  // A build with no database prerenders an empty list rather than failing.
  // `/` and `/pricing` are fully static, so Next fills this entry during
  // `next build` — which would otherwise make a reachable, correctly
  // credentialled Postgres a build-time requirement, and a self-hoster's
  // `docker build` (or a transient blip in CI) a failed release. Ticket 67
  // promises configuration rather than a fork, and a build that needs the
  // production database to compile the marketing copy is not that.
  //
  // Empty rather than a fallback list of prices: a hardcoded price here is
  // exactly the second source of truth ticket 80 deleted, and a wrong price
  // on a pricing page is worse than none. The pages say so when the list is
  // empty, and the default cache profile refreshes within the quarter hour —
  // which is also why this scope takes no longer `cacheLife`.
  try {
    return await readAnonymously(readMarketingTiers)
  } catch (error) {
    console.error('the Tiers could not be read', error)
    return []
  }
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

/**
 * The retention ceiling, from the column rather than from prose.
 *
 * Ticket 80's whole point: this used to be a hand-written line inside
 * `features.includes` ("A year of history"), which is a second source of truth
 * wearing a different hat — an operator who raises `retention_max_days` on
 * `/admin/tiers` changes what an Org may keep and does not change that line.
 */
export const tierRetention = (
  tier: Pick<MarketingTier, 'retentionMaxDays'>,
) => {
  const days = tier.retentionMaxDays
  if (days === null) return 'History kept for as long as you keep it'
  if (days % 365 === 0) {
    const years = days / 365
    return years === 1 ? 'A year of history' : `${years} years of history`
  }
  return `${days} days of history`
}

/** The seat allowance, in a sentence rather than as two numbers. */
export const tierSeats = (tier: TierPricing): string => {
  if (tier.maxSeats === 1) return 'One person, no seat management'
  if (tier.maxSeats === null) {
    return tier.minSeats === null ? 'No seat limit' : `${tier.minSeats} and up`
  }
  return `${tier.minSeats ?? 1} to ${tier.maxSeats} seats`
}
