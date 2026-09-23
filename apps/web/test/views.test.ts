import { expect, test } from 'vitest'

import {
  DEFAULT_VIEW,
  isDimension,
  resolveTimeColumn,
  resolveView,
  tickDates,
  viewHref,
} from '../app/(dashboard)/costs/views'

// Ticket 78 added a fifth view. Two things about it are easy to break without
// noticing: a link to it must carry the period the reader is looking at, and
// it must not be mistaken for a breakdown dimension.

test('a link to a view keeps the period it was made from', () => {
  expect(viewHref('/costs', 'failures', { range: 'last-7' })).toBe(
    '/costs?range=last-7&view=failures',
  )
  expect(
    viewHref('/costs', 'failures', { from: '2026-09-01', to: '2026-09-30' }),
  ).toBe('/costs?from=2026-09-01&to=2026-09-30&view=failures')
})

test('the default view is left out of the link, and nothing else is carried', () => {
  expect(viewHref('/costs', DEFAULT_VIEW, { range: 'last-7' })).toBe(
    '/costs?range=last-7',
  )
  expect(viewHref('/costs', 'failures', { view: 'members' })).toBe(
    '/costs?view=failures',
  )
})

test('failures is not a breakdown dimension', () => {
  expect(isDimension('failures')).toBe(false)
  expect(isDimension('time')).toBe(false)
  expect(isDimension('members')).toBe(true)
})

test('an unknown view in the URL falls back rather than erroring', () => {
  expect(resolveView('failures')).toBe('failures')
  expect(resolveView('nonsense')).toBe(DEFAULT_VIEW)
  expect(resolveView(undefined)).toBe(DEFAULT_VIEW)
})

test('an Over time column opens a real day or a model, nothing else', () => {
  expect(resolveTimeColumn('day:2026-09-23')).toEqual({
    kind: 'day',
    date: '2026-09-23',
  })
  expect(resolveTimeColumn('model:claude-opus-4-6')).toEqual({
    kind: 'model',
    model: 'claude-opus-4-6',
  })
  // A model name may itself hold a colon; only the first one is the kind's.
  expect(resolveTimeColumn('model:vendor:x')).toEqual({
    kind: 'model',
    model: 'vendor:x',
  })
  expect(resolveTimeColumn('day:2026-02-30')).toBeNull()
  expect(resolveTimeColumn('day:yesterday')).toBeNull()
  expect(resolveTimeColumn('model:')).toBeNull()
  expect(resolveTimeColumn('m1')).toBeNull()
  expect(resolveTimeColumn(undefined)).toBeNull()
})

test('the chart labels its first day, its last, and today between them', () => {
  const days = Array.from(
    { length: 30 },
    (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
  )
  expect(tickDates(days, '2026-09-23')).toEqual([
    '2026-09-01',
    '2026-09-23',
    '2026-09-30',
  ])
  // Today on top of an end would print over it, so the end speaks for it.
  expect(tickDates(days, '2026-09-29')).toEqual(['2026-09-01', '2026-09-30'])
  expect(tickDates(days, '2026-10-05')).toEqual(['2026-09-01', '2026-09-30'])
  expect(tickDates(['2026-09-01'], '2026-09-01')).toEqual(['2026-09-01'])
})
