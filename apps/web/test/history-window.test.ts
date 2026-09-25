import { beforeEach, expect, test } from 'vitest'

import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 139: a Tier's history window hides older Turns from every dashboard
// read, through the read policy, and deletes nothing.

let fixture: Fixture
let nth = 0

beforeEach(async () => {
  fixture = await seedFixture()
  nth = 0
})

const onTier = async (
  orgId: string,
  historyDays: number | null,
  status = 'active',
) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, history_days, sort_order)
    values (${`h-${orgId}-${historyDays}-${status}`}, 'T', 10, ${historyDays}, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${orgId}, ${tier!.id}, ${status})
    on conflict (org_id) do update
      set tier_id = excluded.tier_id, status = excluded.status
  `
}

const turn = async (daysAgo: number, session = 's1') => {
  nth += 1
  await sql`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, ${session},
            ${`m${nth}`}, now() - ${`${daysAgo} days`}::interval)
  `
}

const visible = (role: 'owner' | 'member') =>
  asRole(fixture.acme, role, async (tx) => {
    const [row] = await tx<{ n: number }[]>`
      select count(*)::int as n from turn_costs cost
        join turns turn on turn.id = cost.turn_id
       where turn.org_id = ${fixture.acme.id}
    `
    return row!.n
  })

test('Turns older than the window are hidden from every Role, and kept', async () => {
  await onTier(fixture.acme.id, 90)
  await turn(10)
  await turn(89)
  await turn(92, 's2')
  await turn(400, 's3')

  expect(await visible('owner')).toBe(2)
  expect(await visible('member')).toBe(2)
  const [kept] = await sql`select count(*)::int as n from turns`
  expect(kept!.n).toBe(4)
})

test('no window, or no live subscription, shows everything', async () => {
  await turn(400)
  expect(await visible('owner')).toBe(1)
  await onTier(fixture.acme.id, null)
  expect(await visible('owner')).toBe(1)
  await onTier(fixture.acme.id, 90, 'inactive')
  expect(await visible('owner')).toBe(1)
})

test('an upgrade brings older Turns back', async () => {
  await onTier(fixture.acme.id, 90)
  await turn(200)
  expect(await visible('owner')).toBe(0)
  await onTier(fixture.acme.id, 365)
  expect(await visible('owner')).toBe(1)
})

test('a straddling Session reports its hidden Turns', async () => {
  await onTier(fixture.acme.id, 90)
  await turn(10, 'edge')
  await turn(120, 'edge')
  await turn(10, 'inside')
  const hidden = (session: string) =>
    asRole(fixture.acme, 'owner', async (tx) => {
      const [row] = await tx<{ hidden: boolean }[]>`
        select sessclone_session_has_hidden_turns(
          ${fixture.acme.members.member}, ${session}) as hidden
      `
      return row!.hidden
    })
  expect(await hidden('edge')).toBe(true)
  expect(await hidden('inside')).toBe(false)
  // Somebody who cannot see the Member learns nothing.
  const outsider = await asRole(fixture.globex, 'owner', async (tx) => {
    const [row] = await tx<{ hidden: boolean }[]>`
      select sessclone_session_has_hidden_turns(
        ${fixture.acme.members.member}, 'edge') as hidden
    `
    return row!.hidden
  })
  expect(outsider).toBe(false)
})

test('failure events follow the same window', async () => {
  await onTier(fixture.acme.id, 90)
  await sql`
    insert into session_events (org_id, member_id, session_id, kind, occurred_at)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, 'old', 'session_end',
            now() - interval '200 days'),
           (${fixture.acme.id}, ${fixture.acme.members.member}, 'new', 'session_end',
            now() - interval '2 days')
  `
  const rows = await asRole(
    fixture.acme,
    'owner',
    (tx) => tx`select session_id from session_events`,
  )
  expect(rows.map((row) => row.session_id)).toEqual(['new'])
})
