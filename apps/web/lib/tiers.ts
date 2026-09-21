/**
 * The Tiers the pricing page renders.
 *
 * **This is a placeholder for a database read, and it is shaped like one.**
 * Every field below is a column on the `tiers` table from ticket 24, with the
 * same name and the same meaning — null `seatPriceUsd` and null
 * `basePriceUsd` together mean "contact us", which is a real Tier and not a
 * missing value; null `maxSeats` means no limit; null `retentionMaxDays`
 * means no ceiling. Ticket 80 replaces the body of `marketingTiers()` with a
 * `select` against that table wrapped in `'use cache'` and tagged
 * `cacheTag('tiers')`, and nothing that consumes it has to change.
 *
 * The prices here are the ones settled on 2026-09-20 and recorded in
 * `docs/design/marketing-site.md`. They live in exactly one module so that
 * the swap is a swap; a price copied into a page is a second source of truth
 * and the page it is copied into is the one that goes stale.
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

export const marketingTiers = (): MarketingTier[] => [
  {
    key: 'self_hosted',
    name: 'Self-Hosted',
    description: 'Run it yourself, free, at any size.',
    basePriceUsd: 0,
    seatPriceUsd: 0,
    minSeats: null,
    maxSeats: null,
    retentionMaxDays: null,
    archivalAvailable: true,
    includes: [
      'Every feature, no seat limit',
      'Your database, your storage, your network',
      'The sessclone credit stays visible in the panel',
      'AGPL: run it for other people, offer them the source',
    ],
    sortOrder: 0,
  },
  {
    key: 'personal',
    name: 'Personal',
    description: 'One person, every machine they run Claude Code on.',
    basePriceUsd: 5,
    seatPriceUsd: null,
    minSeats: 1,
    maxSeats: 1,
    retentionMaxDays: 90,
    archivalAvailable: false,
    includes: [
      'Unlimited Devices and Projects',
      'Cost per Session, Project and Device',
      '90 days of history',
    ],
    sortOrder: 1,
  },
  {
    key: 'team',
    name: 'Team',
    description: 'A team that wants one number for all of it.',
    basePriceUsd: null,
    seatPriceUsd: 10,
    minSeats: 2,
    maxSeats: 10,
    retentionMaxDays: 365,
    archivalAvailable: true,
    includes: [
      'Everything in Personal, per Member',
      'Roles: Owner, Admin, Manager, Member',
      'Manager Scopes, so a lead sees their own people',
      'A year of history',
    ],
    sortOrder: 2,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    description: 'Eleven seats and up, or terms of your own.',
    basePriceUsd: null,
    seatPriceUsd: null,
    minSeats: 11,
    maxSeats: null,
    retentionMaxDays: null,
    archivalAvailable: true,
    includes: [
      'Everything in Team, with no seat ceiling',
      'Negotiated per-model rates',
      'Retention set to your own policy',
      'Single sign-on and an invoice',
    ],
    sortOrder: 3,
  },
]

/**
 * What a card puts where the price goes. A Tier with neither price is
 * "Contact" rather than free — the failure ticket 80 names explicitly, and
 * the one that costs the most when it happens.
 */
export const tierPrice = (
  tier: MarketingTier,
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
export const tierSeats = (tier: MarketingTier): string => {
  if (tier.maxSeats === 1) return 'One person, no seat management'
  if (tier.maxSeats === null) {
    return tier.minSeats === null ? 'No seat limit' : `${tier.minSeats} and up`
  }
  return `${tier.minSeats ?? 1} to ${tier.maxSeats} seats`
}
