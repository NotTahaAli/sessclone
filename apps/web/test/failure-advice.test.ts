import { expect, test } from 'vitest'

import { adviceFor } from '../lib/failure-advice'

// Ticket 78: the advice a failure carries. Small, but it is what turns "a
// Session failed" into "and here is what to do", so the mapping is pinned.

test('a known type carries advice, its tone and the cost verdict', () => {
  const rate = adviceFor('rate_limit')
  expect(rate.tone).toBe('transient')
  expect(rate.advice).toContain('rate limit')
  expect(rate.costsAffected).toBe(false)

  const billing = adviceFor('billing_error')
  expect(billing.tone).toBe('lost')
  expect(billing.advice).toContain('billing')
})

test('the lookup ignores case', () => {
  expect(adviceFor('RATE_LIMIT').advice).toBe(adviceFor('rate_limit').advice)
})

test('an unknown type gets a neutral entry with no advice', () => {
  // The surface then shows the recorded message as recorded, rather than a
  // generic line pretending to be advice.
  const unknown = adviceFor('some_new_error')
  expect(unknown.tone).toBe('neutral')
  expect(unknown.advice).toBeNull()
})
