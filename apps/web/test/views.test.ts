import { expect, test } from 'vitest'

import {
  DEFAULT_VIEW,
  isDimension,
  resolveView,
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
