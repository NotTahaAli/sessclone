import { expect, test } from 'vitest'

import { parsePlan, planQuery, returnPath, signupStep } from '../lib/auth/plan'

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

// Sign-up in two steps (Taha, 2026-09-24): a plan, then an account. The
// pricing page already knows the plan and the team size, so a link from it
// lands on the second step; `edit` is the way back to the first.

const offered = [
  { key: 'personal', minSeats: 1, maxSeats: 1 },
  { key: 'team', minSeats: 2, maxSeats: 10 },
]

test('a complete plan in the query skips straight to the account step', () => {
  expect(signupStep(params('plan=team&seats=3'), offered)).toEqual({
    step: 'account',
    plan: { tierKey: 'team', seats: 3 },
  })
  expect(signupStep(params('plan=personal'), offered)).toEqual({
    step: 'account',
    plan: { tierKey: 'personal', seats: 1 },
  })
})

test('the account step clamps a size the Tier refuses', () => {
  expect(signupStep(params('plan=team&seats=40'), offered)).toEqual({
    step: 'account',
    plan: { tierKey: 'team', seats: 10 },
  })
})

test('no plan, a plan not on offer, or a Team with no size asks for one', () => {
  const first = { step: 'plan', chosen: 'personal', seats: 2 }
  expect(signupStep(params(''), offered)).toEqual(first)
  expect(signupStep(params('plan=enterprise'), offered)).toEqual(first)
  expect(signupStep(params('plan=team'), offered)).toEqual({
    ...first,
    chosen: 'team',
  })
  expect(signupStep(params('plan=team&seats=3'), [offered[0]!])).toEqual({
    ...first,
    chosen: 'personal',
  })
})

test('`edit` goes back to the plan step with the choice kept', () => {
  expect(signupStep(params('plan=team&seats=6&edit=1'), offered)).toEqual({
    step: 'plan',
    chosen: 'team',
    seats: 6,
  })
})

const form = (entries: Record<string, string>) => new URLSearchParams(entries)

test('a failed form returns to the page it came from, plan kept', () => {
  expect(returnPath(form({}), 'error=email')).toBe('/sign-in?error=email')
  expect(
    returnPath(form({ from: 'sign-up', plan: 'team', seats: '4' }), 'sent=1'),
  ).toBe('/sign-up?plan=team&seats=4&sent=1')
  // Only the two pages are places to return to.
  expect(returnPath(form({ from: '//evil.example' }), 'sent=1')).toBe(
    '/sign-in?sent=1',
  )
})
