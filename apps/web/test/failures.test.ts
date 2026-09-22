import { beforeEach, expect, test } from 'vitest'

import { countFailures, FAILURES_LIMIT, sessionFailures } from '../lib/failures'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 78. The failures read is `breakdown`'s shape, so what is proven here
// is the part easy to get quietly wrong: who sees which rows (the policy, not
// the UI), the date-range cut, and that a name the viewer cannot see comes
// back null rather than dropping the failure.

const september = { from: '2026-09-01', to: '2026-10-01' }

let fixture: Fixture
let nextEvent = 0

beforeEach(async () => {
  fixture = await seedFixture()
  nextEvent = 0
})

const seedFailure = async (over: Record<string, unknown> = {}) => {
  nextEvent += 1
  await sql`
    insert into session_events ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: `session-${nextEvent}`,
      kind: 'stop_failure',
      occurred_at: '2026-09-20T08:00:00Z',
      detail: sql.json({ error_type: 'rate_limit', message: '429' }),
      ...over,
    })}
  `
}

const device = async (
  memberId: string,
  key: string,
  nickname: string | null,
) => {
  const [row] = await sql<{ id: string }[]>`
    insert into devices (member_id, key, nickname)
    values (${memberId}, ${key}, ${nickname}) returning id
  `
  return row!.id
}

test('a row names the session, type, message, device and member', async () => {
  const deviceId = await device(
    fixture.acme.members.member,
    'host:laptop',
    'Work laptop',
  )
  await seedFailure({
    session_id: 'session-x',
    agent_id: 'agent-2',
    device_id: deviceId,
    detail: sql.json({ error_type: 'overloaded', message: 'API Error' }),
  })

  const { rows, total } = await asRole(fixture.acme, 'owner', (tx) =>
    sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )

  expect(total).toBe(1)
  expect(rows[0]).toMatchObject({
    sessionId: 'session-x',
    agentId: 'agent-2',
    errorType: 'overloaded',
    message: 'API Error',
    device: 'Work laptop',
    // "when it failed" is a named acceptance criterion, so it is asserted
    // rather than assumed: the row carries the recorded instant, not the read.
    occurredAt: '2026-09-20T08:00:00.000Z',
  })
  expect(rows[0]!.member).toContain('@')
})

test('newest first', async () => {
  await seedFailure({
    session_id: 'older',
    occurred_at: '2026-09-10T08:00:00Z',
  })
  await seedFailure({
    session_id: 'newer',
    occurred_at: '2026-09-25T08:00:00Z',
  })

  const { rows } = await asRole(fixture.acme, 'owner', (tx) =>
    sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )
  expect(rows.map((row) => row.sessionId)).toEqual(['newer', 'older'])
})

test('only failures inside the range are counted', async () => {
  await seedFailure({ occurred_at: '2026-08-31T23:00:00Z' }) // before
  await seedFailure({ occurred_at: '2026-09-15T08:00:00Z' }) // inside
  await seedFailure({ occurred_at: '2026-10-01T00:00:00Z' }) // the open end

  const count = await asRole(fixture.acme, 'owner', (tx) =>
    countFailures(tx, fixture.acme.id, 'UTC', september),
  )
  expect(count).toBe(1)
})

test('the range is cut in the Org’s timezone, not UTC', async () => {
  // 2026-09-01T02:00Z is still 31 Aug in Los Angeles, so a September range read
  // in that zone must not include it — the same conversion the cost views make.
  await seedFailure({ occurred_at: '2026-09-01T02:00:00Z' })

  const utc = await asRole(fixture.acme, 'owner', (tx) =>
    countFailures(tx, fixture.acme.id, 'UTC', september),
  )
  const la = await asRole(fixture.acme, 'owner', (tx) =>
    countFailures(tx, fixture.acme.id, 'America/Los_Angeles', september),
  )
  expect(utc).toBe(1)
  expect(la).toBe(0)
})

test('a Member sees only their own failures, through the policy', async () => {
  await seedFailure({
    member_id: fixture.acme.members.owner,
    session_id: 'theirs',
  })
  await seedFailure({
    member_id: fixture.acme.members.member,
    session_id: 'mine',
  })

  const { rows } = await asRole(fixture.acme, 'member', (tx) =>
    sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )
  // Named, not counted: a policy that returned somebody else's one failure
  // would satisfy a length check and leak.
  expect(rows.map((row) => row.sessionId)).toEqual(['mine'])
})

test('a Manager sees their Scope and nobody else', async () => {
  await seedFailure({
    member_id: fixture.acme.members.owner,
    session_id: 'owners',
  })
  await seedFailure({
    member_id: fixture.acme.members.member,
    session_id: 'in-scope',
  })

  const { rows } = await asRole(fixture.acme, 'manager', (tx) =>
    sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )
  // The fixture's Scope holds the Member and not the Owner.
  expect(rows.map((row) => row.sessionId)).toEqual(['in-scope'])
})

test('a Manager with an empty Scope sees nothing', async () => {
  // The most visible leak: a Manager who should see nobody. The fixture builds
  // this role for exactly that reason.
  await seedFailure({ member_id: fixture.acme.members.owner })
  await seedFailure({ member_id: fixture.acme.members.member })

  const { rows, total } = await asRole(
    fixture.acme,
    'managerWithoutScope',
    (tx) => sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )
  expect(rows).toEqual([])
  expect(total).toBe(0)
})

test('a removed Member sees nothing, and their failures still show to the Owner', async () => {
  await seedFailure({
    member_id: fixture.acme.members.removed,
    session_id: 'left-the-org',
  })

  const theirs = await asRole(fixture.acme, 'removed', (tx) =>
    sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )
  expect(theirs.rows).toEqual([])

  // The failure happened while they were here, so the Org's record keeps it.
  const owners = await asRole(fixture.acme, 'owner', (tx) =>
    sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )
  expect(owners.rows.map((row) => row.sessionId)).toEqual(['left-the-org'])
})

test('one Org’s failures never leak into another’s read', async () => {
  await seedFailure()
  await sql`
    insert into session_events ${sql({
      org_id: fixture.globex.id,
      member_id: fixture.globex.members.member,
      session_id: 'globex-1',
      kind: 'stop_failure',
      occurred_at: '2026-09-20T08:00:00Z',
      detail: sql.json({ error_type: 'rate_limit', message: null }),
    })}
  `
  const count = await asRole(fixture.acme, 'owner', (tx) =>
    countFailures(tx, fixture.acme.id, 'UTC', september),
  )
  expect(count).toBe(1)
})

test('the list is capped and reports how many more there are', async () => {
  // One past the cap: the page shows the cap and says one more, and the total
  // still counts them all.
  for (let n = 0; n < FAILURES_LIMIT + 1; n += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential seed, order matters for nothing here
    await seedFailure()
  }

  const { rows, total, more } = await asRole(fixture.acme, 'owner', (tx) =>
    sessionFailures(tx, fixture.acme.id, 'UTC', september),
  )
  expect(rows).toHaveLength(FAILURES_LIMIT)
  expect(total).toBe(FAILURES_LIMIT + 1)
  expect(more).toBe(1)
})
