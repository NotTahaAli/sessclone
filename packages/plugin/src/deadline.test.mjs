import { expect, test } from 'vitest'

import { NO_DEADLINE, deadlineIn, expired, requestSignal } from './deadline.mjs'

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('a request is cut short by the deadline rather than its own limit', async () => {
  // The bug this guards is the one a Member saw as "Hook cancelled": an upload
  // allowed eight seconds, started when the hook had one left, runs seven
  // seconds past the moment Claude Code kills the hook.
  const signal = requestSignal(8000, deadlineIn(50))
  await settle(400)
  expect(signal.aborted).toBe(true)
})

test('a request past the deadline is still issued, briefly, rather than throwing', async () => {
  // `deadline - Date.now()` is negative once the time is spent, and
  // `AbortSignal.timeout(-1)` throws — which would turn a late flush into an
  // exception instead of a skipped request.
  const signal = requestSignal(8000, Date.now() - 5000)
  expect(signal.aborted).toBe(false)
  await settle(400)
  expect(signal.aborted).toBe(true)
})

test('a request keeps its own limit when there is time, or no deadline at all', async () => {
  const bounded = requestSignal(8000, deadlineIn(60_000))
  const unbounded = requestSignal(8000, NO_DEADLINE)
  await settle(400)
  expect(bounded.aborted).toBe(false)
  expect(unbounded.aborted).toBe(false)
})

test('a deadline in the past has expired and one in the future has not', () => {
  expect(expired(Date.now() - 1)).toBe(true)
  expect(expired(deadlineIn(60_000))).toBe(false)
  expect(expired(NO_DEADLINE)).toBe(false)
})
