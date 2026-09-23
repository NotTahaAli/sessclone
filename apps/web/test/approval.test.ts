import { afterEach, expect, test, vi } from 'vitest'

import { approvalRequired, isLocked } from '../lib/approval'

// Ticket 119: which statuses lock an Org, and the one switch that unlocks all
// of them. The vitest config sets `SIGNUP_APPROVAL=off` so suites about
// something else run as before; each test here sets it itself.

afterEach(() => {
  vi.unstubAllEnvs()
})

test('on unless it is switched off, self-hosted deployments included', () => {
  vi.stubEnv('SIGNUP_APPROVAL', undefined)
  expect(approvalRequired()).toBe(true)
  vi.stubEnv('SIGNUP_APPROVAL', 'on')
  expect(approvalRequired()).toBe(true)
  vi.stubEnv('SIGNUP_APPROVAL', ' OFF ')
  expect(approvalRequired()).toBe(false)
})

test('inactive, no row and cancelled lock; active and past due do not', () => {
  vi.stubEnv('SIGNUP_APPROVAL', undefined)
  expect(isLocked('inactive')).toBe(true)
  expect(isLocked(null)).toBe(true)
  expect(isLocked('cancelled')).toBe(true)
  expect(isLocked('active')).toBe(false)
  expect(isLocked('past_due')).toBe(false)
})

test('switched off, nothing locks', () => {
  vi.stubEnv('SIGNUP_APPROVAL', 'off')
  expect(isLocked('inactive')).toBe(false)
  expect(isLocked(null)).toBe(false)
  expect(isLocked('cancelled')).toBe(false)
})
