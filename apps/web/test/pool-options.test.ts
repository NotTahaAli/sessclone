import { describe, expect, it } from 'vitest'

import { poolOptions } from '../lib/db'

// This app is deployed on a serverless host reading Postgres through a
// transaction-mode pooler, and both options below are the difference between
// that working and it failing in a way that looks like the database is broken.
// Neither has a test that exercises it — reproducing them needs a pooler and a
// frozen instance — so they are pinned here, with the failure each prevents
// written down beside it.
describe('poolOptions', () => {
  it('disables prepared statements, which a transaction-mode pooler refuses', () => {
    // Removing this fails every query after the first with
    // `prepared statement "…" already exists`, because the pooler gives the
    // next statement to a different backend connection.
    expect(poolOptions.prepare).toBe(false)
  })

  it('closes idle connections before the host freezes the instance', () => {
    // A frozen instance's keepalive timers freeze with it, so a connection the
    // pooler has since dropped is still in the pool when the instance wakes —
    // and the next query hangs on a dead socket until the function times out.
    expect(poolOptions.idle_timeout).toBeGreaterThan(0)
    expect(poolOptions.idle_timeout).toBeLessThanOrEqual(30)
  })
})
