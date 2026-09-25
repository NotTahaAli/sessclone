import type { MarketingTier, TierPricing } from './tiers'

// The pricing page's team-size logic (ticket 115), pure so it is unit-tested
// without a browser. Every number comes from the Tier row it is handed; the
// only literals here are the words around them.

/** The slider's top stop, read as "this many or more". */
export const MAX_TEAM = 25

/** "3 people", "1 person", "25+ people". */
export const peopleLabel = (n: number) =>
  `${n >= MAX_TEAM ? `${MAX_TEAM}+` : n} ${n === 1 ? 'person' : 'people'}`

/** Free at any size: both prices zero. The Self-Hosted Tier, found by its
 * price rather than its key, so it is always shown and never recommended. */
export const isFree = (tier: TierPricing) =>
  tier.basePriceUsd === 0 && tier.seatPriceUsd === 0

/** Whether a team of `n` may be on this Tier. */
export const fits = (tier: TierPricing, n: number) =>
  n >= (tier.minSeats ?? 1) && (tier.maxSeats === null || n <= tier.maxSeats)

/**
 * The paid Tier a team of `n` is marked with: the first by sort order whose
 * seat range holds `n`. With the seed that is Personal at 1, Team at 2 to 10
 * and Enterprise from 11, but the ranges are the rows', not this function's.
 */
export const recommendedTier = (
  tiers: readonly (TierPricing & { key: string })[],
  n: number,
) => tiers.find((tier) => !isFree(tier) && fits(tier, n))?.key ?? null

/** Why a Tier does not fit `n`, or null when it does. */
export const unfitReason = (tier: TierPricing, n: number) => {
  if (fits(tier, n)) return null
  const min = tier.minSeats ?? 1
  if (n < min) return `from ${peopleLabel(min)}`
  return tier.maxSeats === 1 ? '1 person only' : `up to ${tier.maxSeats} seats`
}

/** What a team of `n` pays a month on this Tier, and how it adds up: the
 * base price, plus each seat past the ones it includes. */
export const priceFor = (
  tier: TierPricing & { includedSeats: number },
  n: number,
): { amount: string; per: string } => {
  const { basePriceUsd: base, seatPriceUsd: seat } = tier
  if (base === null && seat === null) return { amount: 'Talk to us', per: '' }
  if (isFree(tier)) return { amount: 'Free', per: 'your servers' }
  const seats = Math.max(n, tier.minSeats ?? 1)
  const charged = Math.max(0, seats - tier.includedSeats)
  const total = (base ?? 0) + (seat ?? 0) * charged
  const parts = [
    base ? `$${base}/month` : null,
    seat && charged ? `${charged} × $${seat}/seat/month` : null,
  ].filter(Boolean)
  return {
    amount: `$${total}`,
    per: seat && charged ? parts.join(' + ') : '/month flat',
  }
}

/** The short price a landing row and the comparison show. */
export const shortPrice = (tier: TierPricing) => {
  if (tier.basePriceUsd === null && tier.seatPriceUsd === null) {
    return 'Talk to us'
  }
  if (isFree(tier)) return 'Free'
  if (tier.seatPriceUsd) return `$${tier.seatPriceUsd}/seat`
  return `$${tier.basePriceUsd}/mo`
}

/** The seat range, compact: "1", "2–10", "11+", "Any". */
export const seatRange = (tier: TierPricing) => {
  const { minSeats: min, maxSeats: max } = tier
  if (max === null) return min === null ? 'Any' : `${min}+`
  if (max === (min ?? 1)) return String(max)
  return `${min ?? 1}–${max}`
}

/** A number of days, compact; null is unlimited. */
export const historyShort = (days: number | null) => {
  if (days === null) return 'Unlimited'
  if (days % 365 === 0) {
    return days === 365 ? '1 year' : `${days / 365} years`
  }
  return `${days} days`
}

/** The line ticket 115 gives Enterprise's per-model rates. */
export const OWN_RATES_LINE =
  'Your own per-model rates (e.g. an Anthropic discount)'

type Cell = string | boolean

/**
 * The comparison table's rows, one cell per Tier in the order given.
 *
 * A free Tier is the self-hosted code with every gate open, so it reads as
 * having every feature whether or not its `features` names each gate.
 */
export const comparison = (
  tiers: readonly MarketingTier[],
): { label: string; cells: Cell[] }[] => {
  const row = (label: string, cell: (tier: MarketingTier) => Cell) => ({
    label,
    cells: tiers.map(cell),
  })
  return [
    row('Seats', seatRange),
    row('Price', shortPrice),
    row('History', (tier) => historyShort(tier.historyDays)),
    row('Roles and Manager Scopes', (t) => isFree(t) || t.managerScopes),
    row('Transcript archival', (tier) => transcriptsShort(tier)),
    row('Per-model rates', (tier) =>
      isFree(tier) ? 'Yours' : ownRates(tier) ? OWN_RATES_LINE : 'Published',
    ),
    row('Single sign-on', (tier) =>
      isFree(tier) ? 'Bring your own' : tier.sso,
    ),
  ]
}

// Ticket 121's migration writes `features.own_rates` on Enterprise, so the
// flag alone decides; an absent key reads as published rates.
const ownRates = (tier: MarketingTier) => tier.ownRates === true

/** How long transcripts are kept, compact (ticket 139): the Tier's cap,
 * the contract's where there is none on a paid Tier, or none at all. */
const transcriptsShort = (tier: MarketingTier): Cell => {
  if (!tier.archivalAvailable) return false
  if (tier.retentionMaxDays !== null) return historyShort(tier.retentionMaxDays)
  return isFree(tier) ? 'Your policy' : 'Per contract'
}

/** The lines a plan lists: its prose, then the columns it reads. */
export const planLines = (tier: MarketingTier, history: string) => [
  ...tier.includes,
  ...(tier.archivalAvailable && !isFree(tier)
    ? [
        tier.retentionMaxDays === null
          ? 'Transcript archival, opt-in per Member, kept per contract'
          : `Transcript archival, opt-in per Member, kept up to ${tier.retentionMaxDays} days`,
      ]
    : []),
  history,
]
