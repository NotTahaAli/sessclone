import { expect, test } from 'vitest'

import { compact, count, usd } from '../lib/money'

// Expected strings were taken from running the formatters, not written from
// memory: `Intl` output depends on the runtime.

test('an unknown cost is a dash and a genuine zero is $0.00', () => {
  expect(usd(null)).toBe('—')
  expect(usd(0)).toBe('$0.00')
})

test('below half a cent shows six decimals, never $0.00', () => {
  expect(usd(0.004999)).toBe('$0.004999')
  expect(usd(0.005)).toBe('$0.01')
  expect(usd(0.0003)).toBe('$0.000300')
  expect(usd(-0.0003)).toBe('-$0.000300')
})

test('ordinary and large amounts show cents', () => {
  expect(usd(-12.345)).toBe('-$12.35')
  expect(usd(1234567.891)).toBe('$1,234,567.89')
})

test('counts are exact and compact totals are short', () => {
  expect(count.format(1234)).toBe('1,234')
  expect(count.format(1234567)).toBe('1,234,567')
  expect(compact.format(1234)).toBe('1.2K')
  expect(compact.format(1234567)).toBe('1.2M')
})
