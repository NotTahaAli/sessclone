import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import type { FailureRow } from '../lib/failures'

// The action posts to the database; only whether its form renders matters.
vi.mock('../app/(dashboard)/costs/failure-actions', () => ({
  markFailuresViewedAction: async () => undefined,
}))

const { FailuresList } = await import('../app/(dashboard)/costs/failures-list')

const row = (viewed: boolean): FailureRow => ({
  id: '1',
  occurredAt: '2026-09-20T08:00:00Z',
  sessionId: 'session-1',
  agentId: null,
  errorType: 'rate_limit',
  message: '429',
  device: null,
  member: null,
  memberId: 'member-1',
  viewed,
})

const render = (rows: FailureRow[], unviewed: number) =>
  renderToStaticMarkup(
    createElement(FailuresList, {
      failures: { rows, total: rows.length + 60, more: 60 },
      unviewed,
      seenAt: '2026-09-23T12:00:00.000Z',
      timezone: 'UTC',
      params: {},
    }),
  )

// 2026-09-23 review: the list is capped, so every row shown can be viewed
// while failures past the cap are not. "Mark all" follows the period's
// unviewed count — what the pill shows — not the rows on the page.
test('"Mark all viewed" follows the unviewed count, not the capped rows', () => {
  expect(render([row(true)], 3)).toContain('Mark all viewed')
  expect(render([row(false)], 0)).not.toContain('Mark all viewed')
})

// 2026-09-23 review: a mark covers what the page showed, so both forms post
// when the page was read, not leave the server to use the click's time.
test('both mark forms carry the time the page was read', () => {
  const html = render([row(false)], 1)
  expect(
    html.match(/name="seenAt" value="2026-09-23T12:00:00.000Z"/g),
  ).toHaveLength(2)
})
