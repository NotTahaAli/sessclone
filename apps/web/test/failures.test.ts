import { beforeEach, expect, test } from 'vitest'

import {
  countFailures,
  FAILURES_LIMIT,
  markFailuresViewed,
  sessionFailures,
} from '../lib/failures'
import { app, asRole, owner as sql, seedFixture, type Fixture } from './harness'

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
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
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
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
  )
  expect(rows.map((row) => row.sessionId)).toEqual(['newer', 'older'])
})

test('only failures inside the range are counted', async () => {
  await seedFailure({ occurred_at: '2026-08-31T23:00:00Z' }) // before
  await seedFailure({ occurred_at: '2026-09-15T08:00:00Z' }) // inside
  await seedFailure({ occurred_at: '2026-10-01T00:00:00Z' }) // the open end

  const count = await asRole(fixture.acme, 'owner', (tx) =>
    countFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
  )
  expect(count).toBe(1)
})

test('the range is cut in the Org’s timezone, not UTC', async () => {
  // 2026-09-01T02:00Z is still 31 Aug in Los Angeles, so a September range read
  // in that zone must not include it — the same conversion the cost views make.
  await seedFailure({ occurred_at: '2026-09-01T02:00:00Z' })

  const utc = await asRole(fixture.acme, 'owner', (tx) =>
    countFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
  )
  const la = await asRole(fixture.acme, 'owner', (tx) =>
    countFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'America/Los_Angeles',
      september,
    ),
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
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
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
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
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
    (tx) =>
      sessionFailures(
        tx,
        fixture.acme.id,
        fixture.acme.members.owner,
        'UTC',
        september,
      ),
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
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
  )
  expect(theirs.rows).toEqual([])

  // The failure happened while they were here, so the Org's record keeps it.
  const owners = await asRole(fixture.acme, 'owner', (tx) =>
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
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
    countFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
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
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
  )
  expect(rows).toHaveLength(FAILURES_LIMIT)
  expect(total).toBe(FAILURES_LIMIT + 1)
  expect(more).toBe(1)
})

// Taha, 2026-09-23: "allow to mark failed as Viewed". The pill counts failed
// Sessions the viewer has not marked seen; a viewed one stays listed.

const markAs = (
  role: 'owner' | 'member',
  session?: { memberId: string; sessionId: string },
) =>
  asRole(fixture.acme, role, (tx) =>
    markFailuresViewed(tx, {
      orgId: fixture.acme.id,
      viewerMemberId: fixture.acme.members[role],
      timezone: 'UTC',
      range: september,
      session,
    }),
  )

const countAs = (role: 'owner' | 'member') =>
  asRole(fixture.acme, role, (tx) =>
    countFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members[role],
      'UTC',
      september,
    ),
  )

test('the pill counts failed Sessions, not failure events', async () => {
  // One Session failing three times, its Agent Run among them, is one.
  await seedFailure({
    session_id: 'storm',
    occurred_at: '2026-09-20T08:00:00Z',
  })
  await seedFailure({
    session_id: 'storm',
    occurred_at: '2026-09-20T08:01:00Z',
  })
  await seedFailure({
    session_id: 'storm',
    agent_id: 'agent-1',
    occurred_at: '2026-09-20T08:02:00Z',
  })
  await seedFailure({ session_id: 'other' })

  expect(await countAs('owner')).toBe(2)
})

test('a viewed Session stops counting for that viewer alone, and stays listed', async () => {
  await seedFailure({ session_id: 'seen' })
  await seedFailure({ session_id: 'unseen' })

  await markAs('owner', {
    memberId: fixture.acme.members.member,
    sessionId: 'seen',
  })

  expect(await countAs('owner')).toBe(1)
  // Per viewer: the Member whose Session it is still has both to look at.
  expect(await countAs('member')).toBe(2)

  const listed = await asRole(fixture.acme, 'owner', (tx) =>
    sessionFailures(
      tx,
      fixture.acme.id,
      fixture.acme.members.owner,
      'UTC',
      september,
    ),
  )
  expect(listed.rows.map((row) => [row.sessionId, row.viewed])).toEqual(
    expect.arrayContaining([
      ['seen', true],
      ['unseen', false],
    ]),
  )
  expect(listed.total).toBe(2)
})

test('mark all clears the period, and a later failure counts again', async () => {
  await seedFailure({ session_id: 'a' })
  await seedFailure({ session_id: 'b' })
  await markAs('member')
  expect(await countAs('member')).toBe(0)

  // The same Session failing after it was seen is a new failure — judged by
  // when the server received it, not the client's `occurred_at`: a Collector
  // that was offline delivers a failure dated before the mark, and it is
  // still one the viewer has not seen.
  await seedFailure({ session_id: 'a', occurred_at: '2026-09-20T09:00:00Z' })
  expect(await countAs('member')).toBe(1)
})

test('failure_views: own rows only, and only for a Session you can read', async () => {
  await seedFailure({
    member_id: fixture.acme.members.owner,
    session_id: 'owners',
  })

  // A Member cannot see the Owner's failure, so mark all finds nothing to mark.
  expect(await markAs('member')).toBe(0)

  // Nor can they write the row directly, as `sessclone_app`: a Session outside
  // their view, or a mark in somebody else's name.
  const write = (viewer: string, member: string) =>
    asRole(
      fixture.acme,
      'member',
      (tx) =>
        tx`insert into failure_views
           (org_id, viewer_member_id, member_id, session_id)
         values (${fixture.acme.id}, ${viewer}, ${member}, 'owners')`,
    )
  await expect(
    write(fixture.acme.members.member, fixture.acme.members.owner),
  ).rejects.toThrow(/row-level security/)
  await expect(
    write(fixture.acme.members.owner, fixture.acme.members.member),
  ).rejects.toThrow(/row-level security/)

  // The Owner marks it; the Member still cannot read that row.
  await markAs('owner')
  const rows = await asRole(
    fixture.acme,
    'member',
    (tx) => tx`select 1 from failure_views`,
  )
  expect(rows).toHaveLength(0)
  const [who] = await app`select current_user as name`
  expect(who!.name).toBe('sessclone_app')
})
