import { describe, expect, test } from 'vitest'

import { presetHref, presetRange, resolveRange } from '../lib/range'

// Ticket 53. Pure, so it is tested here rather than through a page: what has
// to be right is which two dates a URL means, in the Org's timezone, and what
// happens to a URL that means nothing.

// A Monday, and 00:30 UTC — which is still the previous day in Los Angeles,
// so every case below also checks that the anchor is the Org's today and not
// the server's.
const NOW = new Date('2026-09-21T00:30:00Z')
const LA = 'America/Los_Angeles'

describe('presets', () => {
  test('this month is the calendar month, in the Org timezone', () => {
    expect(presetRange('this-month', LA, NOW)).toEqual({
      from: '2026-09-01',
      to: '2026-10-01',
    })
  })

  test('last month ends where this month starts', () => {
    expect(presetRange('last-month', 'UTC', NOW)).toEqual({
      from: '2026-08-01',
      to: '2026-09-01',
    })
  })

  test('a rolling window includes today', () => {
    // Half-open, so the end is tomorrow. A window that stopped at last
    // midnight would leave this morning's Turns out of "last 7 days".
    expect(presetRange('last-7', 'UTC', NOW)).toEqual({
      from: '2026-09-15',
      to: '2026-09-22',
    })
  })

  test("a rolling window anchors on the Org's today, not the server's", () => {
    // 00:30 UTC on the 21st is 17:30 on the 20th in Los Angeles.
    expect(presetRange('last-7', LA, NOW)).toEqual({
      from: '2026-09-14',
      to: '2026-09-21',
    })
  })

  test('twelve months is whole months, ending with this one', () => {
    expect(presetRange('last-12-months', 'UTC', NOW)).toEqual({
      from: '2025-10-01',
      to: '2026-10-01',
    })
  })
})

describe('the URL', () => {
  test('nothing means this month', () => {
    expect(resolveRange({}, 'UTC', NOW)).toEqual({
      range: { from: '2026-09-01', to: '2026-10-01' },
      preset: 'this-month',
    })
  })

  test('a named preset is used', () => {
    expect(resolveRange({ range: 'last-30' }, 'UTC', NOW).preset).toBe(
      'last-30',
    )
  })

  test('two dates are a custom range, and no preset is current', () => {
    // `to` is the last day counted, which is what the field beside it shows
    // and what a person means by "to the 8th". The half-open end is the 9th.
    expect(
      resolveRange({ from: '2026-03-01', to: '2026-03-08' }, 'UTC', NOW),
    ).toEqual({ range: { from: '2026-03-01', to: '2026-03-09' }, preset: null })
  })

  test('one day is a range of one day', () => {
    expect(
      resolveRange({ from: '2026-03-01', to: '2026-03-01' }, 'UTC', NOW).range,
    ).toEqual({ from: '2026-03-01', to: '2026-03-02' })
  })

  test('a nonsense value falls back rather than failing the page', () => {
    // Query parameters are typed by people and carried by stale links. Four
    // shapes that all have to land on the default instead of an error page.
    for (const params of [
      { range: 'last-decade' },
      { from: 'yesterday', to: 'today' },
      { from: '2026-03-08', to: '2026-03-01' },
      { from: '2026-03-01' },
    ]) {
      expect(resolveRange(params, 'UTC', NOW).preset).toBe('this-month')
    }
  })

  test('a range longer than a year is refused', () => {
    // A bar per day and a query over every Turn inside the window: both are
    // fine at a year and neither is at a decade.
    expect(
      resolveRange({ from: '2020-01-01', to: '2026-01-01' }, 'UTC', NOW).preset,
    ).toBe('this-month')
    expect(
      resolveRange({ from: '2026-01-01', to: '2026-12-31' }, 'UTC', NOW).preset,
    ).toBeNull()
  })

  test('a repeated parameter takes the first, not an array', () => {
    expect(
      resolveRange({ range: ['last-7', 'last-90'] }, 'UTC', NOW).preset,
    ).toBe('last-7')
  })

  test('the default preset has no query string, so the page has one URL', () => {
    expect(presetHref('/costs', 'this-month')).toBe('/costs')
    expect(presetHref('/costs', 'last-90')).toBe('/costs?range=last-90')
  })
})
