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
