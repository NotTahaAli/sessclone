import { describe, expect, it } from 'vitest'

import {
  dayLabel,
  LIVE_MS,
  localDate,
  sessionGlyph,
} from '../app/(dashboard)/sessions/status'

// Ticket 112: the glyph on a Session row and the day break above it.
describe('sessionGlyph', () => {
  const now = Date.parse('2026-09-23T12:00:00Z')

  it('is done when an end was reported, however recent', () => {
    expect(
      sessionGlyph(
        { endedAt: '2026-09-23T11:59:00Z', lastTurnAt: '2026-09-23T11:59:00Z' },
        now,
      ),
    ).toBe('ok')
  })

  it('is live with no end and a recent Turn, idle once quiet', () => {
    const recent = new Date(now - LIVE_MS + 1000).toISOString()
    const quiet = new Date(now - LIVE_MS - 1000).toISOString()
    expect(sessionGlyph({ endedAt: null, lastTurnAt: recent }, now)).toBe(
      'live',
    )
    expect(sessionGlyph({ endedAt: null, lastTurnAt: quiet }, now)).toBe('idle')
  })
})

describe('day breaks', () => {
  it('cuts the day in the Org timezone, not UTC', () => {
    expect(localDate('2026-09-22T20:30:00Z', 'Asia/Karachi')).toBe('2026-09-23')
    expect(localDate('2026-09-22T20:30:00Z', 'UTC')).toBe('2026-09-22')
  })

  it('names today and yesterday, dates the rest', () => {
    expect(dayLabel('2026-09-23', '2026-09-23')).toBe('Today')
    expect(dayLabel('2026-09-22', '2026-09-23')).toBe('Yesterday')
    expect(dayLabel('2026-08-31', '2026-09-01')).toBe('Yesterday')
    expect(dayLabel('2026-09-20', '2026-09-23')).toBe('Sun 20 Sept')
  })
})
