import { expect, test } from 'vitest'

import {
  comparison,
  OWN_RATES_LINE,
  peopleLabel,
  priceFor,
  recommendedTier,
  seatRange,
  shortPrice,
  unfitReason,
} from '../lib/plans'
import type { MarketingTier } from '../lib/tiers'

// Ticket 115's pure logic. The rows below are shaped like the seed so the
// cases read naturally; the database-backed read is `marketing-tiers.test.ts`.
const tier = (key: string, over: Partial<MarketingTier>): MarketingTier => ({
  key,
  name: key,
  description: '',
  basePriceUsd: null,
  seatPriceUsd: null,
  includedSeats: 0,
  minSeats: null,
  maxSeats: null,
  retentionMaxDays: null,
  archivalAvailable: false,
  includes: [],
  managerScopes: false,
  sso: false,
  ownRates: null,
  sortOrder: 0,
  ...over,
})

const selfHosted = tier('self_hosted', { basePriceUsd: 0, seatPriceUsd: 0 })
const personal = tier('personal', { basePriceUsd: 5, minSeats: 1, maxSeats: 1 })
const team = tier('team', { seatPriceUsd: 10, minSeats: 2, maxSeats: 10 })
const enterprise = tier('enterprise', {
  minSeats: 11,
  sso: true,
  ownRates: true,
})
const TIERS = [selfHosted, personal, team, enterprise]

test('the recommended plan follows the team size, never Self-Hosted', () => {
  expect(recommendedTier(TIERS, 1)).toBe('personal')
  expect(recommendedTier(TIERS, 2)).toBe('team')
  expect(recommendedTier(TIERS, 3)).toBe('team')
  expect(recommendedTier(TIERS, 10)).toBe('team')
  expect(recommendedTier(TIERS, 11)).toBe('enterprise')
  expect(recommendedTier(TIERS, 25)).toBe('enterprise')
})

test('the ranges are the rows’: a wider Team takes 12 people', () => {
  const wide = { ...team, maxSeats: 15 }
  expect(recommendedTier([selfHosted, personal, wide, enterprise], 12)).toBe(
    'team',
  )
})

test('a price for the size, and Contact never reads as free', () => {
  expect(priceFor(team, 3)).toEqual({
    amount: '$30',
    per: '3 × $10/seat/month',
  })
  // Below the minimum, the minimum is what is billed.
  expect(priceFor(team, 1).amount).toBe('$20')
  expect(priceFor(personal, 1)).toEqual({ amount: '$5', per: '/month flat' })
  expect(priceFor(enterprise, 12).amount).toBe('Talk to us')
  expect(priceFor(selfHosted, 40).amount).toBe('Free')
})

test('a base price with included seats charges only the seats past them', () => {
  const bundle = tier('bundle', {
    basePriceUsd: 50,
    seatPriceUsd: 10,
    includedSeats: 5,
  })
  expect(priceFor(bundle, 8)).toEqual({
    amount: '$80',
    per: '$50/month + 3 × $10/seat/month',
  })
  // Inside the bundle, the base is the whole price.
  expect(priceFor(bundle, 3)).toEqual({ amount: '$50', per: '/month flat' })
})

test('a plan that does not fit says why', () => {
  expect(unfitReason(personal, 3)).toBe('1 person only')
  expect(unfitReason(team, 1)).toBe('from 2 people')
  expect(unfitReason(team, 12)).toBe('up to 10 seats')
  expect(unfitReason(enterprise, 3)).toBe('from 11 people')
  expect(unfitReason(selfHosted, 1)).toBeNull()
})

test('labels', () => {
  expect(peopleLabel(1)).toBe('1 person')
  expect(peopleLabel(25)).toBe('25+ people')
  expect(TIERS.map(seatRange)).toEqual(['Any', '1', '2–10', '11+'])
  expect(TIERS.map(shortPrice)).toEqual([
    'Free',
    '$5/mo',
    '$10/seat',
    'Talk to us',
  ])
})

const rates = (tiers: MarketingTier[]) =>
  comparison(tiers).find((row) => row.label === 'Per-model rates')!.cells

test('the own-rates line comes from features.own_rates', () => {
  // As seeded: Enterprise carries the flag (ticket 121's migration).
  expect(rates(TIERS)).toEqual([
    'Yours',
    'Published',
    'Published',
    OWN_RATES_LINE,
  ])
  // The flag decides, whichever Tier carries it; absent reads as published.
  expect(
    rates([
      { ...team, ownRates: true },
      { ...enterprise, ownRates: false },
      { ...enterprise, ownRates: null },
    ]),
  ).toEqual([OWN_RATES_LINE, 'Published', 'Published'])
})
