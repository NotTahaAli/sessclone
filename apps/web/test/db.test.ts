import { expect, test, vi } from 'vitest'

import { pageSeenAt } from '../lib/db'
import { anonymous } from './harness'

// CodeRabbit, PR 36: the Costs page used to stamp `seenAt` with the app
// server's clock (`new Date()`), while `markFailuresViewed` compares a mark
// against `session_events.received_at`, which Postgres stamps with its own
// `now()`. Clock skew between the two could mark an unseen failure viewed.
// `pageSeenAt` reads the database's clock instead — proved here by skewing
// the app server's clock far away and checking the value that comes back
// tracks the real wall clock, not the skewed one.

test('pageSeenAt reads the database clock, not the app server clock', async () => {
  const realNowMs = Date.now()
  const skewed = new Date('2000-01-01T00:00:00Z')
  // Fake only `Date`: faking timers wholesale stalls the postgres client's
  // own setTimeout-based plumbing.
  vi.useFakeTimers({ now: skewed, toFake: ['Date'] })
  try {
    const seenAt = await anonymous((tx) => pageSeenAt(tx))
    // Within a generous window of the real wall clock: proves the value did
    // not come from the faked `new Date()`.
    expect(Math.abs(seenAt.getTime() - realNowMs)).toBeLessThan(60_000)
    // Nowhere near the skewed app clock, which is decades off.
    expect(Math.abs(seenAt.getTime() - skewed.getTime())).toBeGreaterThan(
      60_000,
    )
  } finally {
    vi.useRealTimers()
  }
})
