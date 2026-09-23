import { expect, test } from 'vitest'

import { parsePlan, planQuery } from '../lib/auth/plan'

// Ticket 118: the plan travels as a form post and then a query string, both
// trust boundaries.

const params = (query: string) => new URLSearchParams(query)

test('a Team plan carries its size, and survives the round trip', () => {
  const plan = parsePlan(params('plan=team&seats=6'))
  expect(plan).toEqual({ tierKey: 'team', seats: 6 })
  expect(parsePlan(params(planQuery(plan)))).toEqual(plan)
})

test('Personal has no size to choose, whatever was posted', () => {
  expect(parsePlan(params('plan=personal&seats=40'))).toEqual({
    tierKey: 'personal',
    seats: 1,
  })
})

test('anything else is no plan rather than an error', () => {
  expect(parsePlan(params(''))).toBeNull()
  expect(parsePlan(params('plan=enterprise'))).toBeNull()
  expect(parsePlan(params('plan=team&seats=-1'))).toBeNull()
  expect(parsePlan(params('plan=team&seats=2.5'))).toBeNull()
  expect(planQuery(null)).toBe('')
})

test('a Team size is clamped to the Team Tier’s bounds', () => {
  // The GitHub button skips the form's own min and max, and a size the Tier
  // refuses would leave the Org with no plan at all.
  const team = { minSeats: 2, maxSeats: 50 }
  expect(parsePlan(params('plan=team&seats=1'), team)?.seats).toBe(2)
  expect(parsePlan(params('plan=team&seats=900'), team)?.seats).toBe(50)
  expect(parsePlan(params('plan=team&seats=7'), team)?.seats).toBe(7)
  expect(
    parsePlan(params('plan=team&seats=900'), { minSeats: null, maxSeats: null })
      ?.seats,
  ).toBe(900)
})
