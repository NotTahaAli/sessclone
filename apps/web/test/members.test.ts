import { beforeEach, expect, test } from 'vitest'

import { setMemberRemoved, setMemberRole } from '../lib/members'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 50. The policies and the guard already decide who may write these two
// columns (ticket 44's suite proves that). What is here is what this ticket
// adds: removal frees a Seat and keeps the history, re-admission works, and an
// Org cannot be left without an Owner.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const seats = async (orgId: string) => {
  const [row] = await sql<{ seats: number }[]>`
    select sessclone_org_seats(${orgId}) as seats
  `
  return row!.seats
}

const turn = async (memberId: string, messageId: string) =>
  sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: memberId,
      session_id: 'session-1',
      message_id: messageId,
      occurred_at: '2026-09-20T08:00:00Z',
      model: 'claude-opus-4-6',
      input_tokens: 1000,
    })}
  `

test('a Role change takes effect at once', async () => {
  expect(
    await asRole(fixture.acme, 'admin', (tx) =>
      setMemberRole(tx, fixture.acme.members.member, 'manager'),
    ),
  ).toBe(true)

  const [row] = await sql<{ role: string }[]>`
    select role from members where id = ${fixture.acme.members.member}
  `
  expect(row!.role).toBe('manager')
})

test('a Manager cannot change anybody’s Role, including their own', async () => {
  await expect(
    asRole(fixture.acme, 'manager', (tx) =>
      setMemberRole(tx, fixture.acme.members.manager, 'admin'),
    ),
  ).rejects.toThrow(/only an owner or admin may change a role/)
})

test('removing a Member frees the Seat and keeps the history', async () => {
  await turn(fixture.acme.members.member, 'msg_1')
  const before = await seats(fixture.acme.id)

  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setMemberRemoved(tx, fixture.acme.members.member, true),
    ),
  ).toBe(true)
  expect(await seats(fixture.acme.id)).toBe(before - 1)

  // Not a cascade: the row and its Turns are both still there, which is what
  // keeps an Org's totals adding up after somebody leaves.
  const rows = await sql`
    select 1 from turns where member_id = ${fixture.acme.members.member}
  `
  expect(rows).toHaveLength(1)

  // And an Owner still reads them.
  const visible = await asRole(
    fixture.acme,
    'owner',
    (tx) => tx`select 1 from turns where org_id = ${fixture.acme.id}`,
  )
  expect(visible).toHaveLength(1)
})

test('an Admin can re-admit somebody they removed', async () => {
  expect(
    await asRole(fixture.acme, 'admin', (tx) =>
      setMemberRemoved(tx, fixture.acme.members.removed, false),
    ),
  ).toBe(true)

  const [row] = await sql<{ removed_at: Date | null }[]>`
    select removed_at from members where id = ${fixture.acme.members.removed}
  `
  expect(row!.removed_at).toBeNull()
})

test('the last Owner cannot be demoted or removed', async () => {
  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setMemberRole(tx, fixture.acme.members.owner, 'admin'),
    ),
  ).rejects.toThrow(/an org keeps at least one owner/)

  await expect(
    asRole(fixture.acme, 'admin', (tx) =>
      setMemberRemoved(tx, fixture.acme.members.owner, true),
    ),
  ).rejects.toThrow(/an org keeps at least one owner/)

  const [row] = await sql<{ role: string; removed_at: Date | null }[]>`
    select role, removed_at from members where id = ${fixture.acme.members.owner}
  `
  expect(row).toMatchObject({ role: 'owner', removed_at: null })
})

test('handing the Org over in one statement is allowed', async () => {
  // The trigger is deferred to the end of the statement, so a swap that ends
  // with an Owner passes even though the row order says otherwise.
  await asRole(
    fixture.acme,
    'owner',
    (tx) => tx`
      update members
         set role = case when id = ${fixture.acme.members.owner} then 'admin'
                         else 'owner' end::member_role
       where id in (${fixture.acme.members.owner}, ${fixture.acme.members.admin})
    `,
  )

  const rows = await sql<{ id: string; role: string }[]>`
    select id, role from members
     where id = ${fixture.acme.members.owner}
        or id = ${fixture.acme.members.admin}
  `
  expect(Object.fromEntries(rows.map((row) => [row.id, row.role]))).toEqual({
    [fixture.acme.members.owner]: 'admin',
    [fixture.acme.members.admin]: 'owner',
  })
})

test('a write refused by the policy reports it rather than looking done', async () => {
  // Another Org's Member: `members_write` matches nothing, so nothing is
  // written and nothing is raised.
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setMemberRole(tx, fixture.globex.members.member, 'admin'),
    ),
  ).toBe(false)
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setMemberRemoved(tx, fixture.globex.members.member, true),
    ),
  ).toBe(false)
})

test('re-admitting a Member cannot take the Org over its Tier’s ceiling', async () => {
  // The other way a Member becomes live. The ceiling lives in one trigger, so
  // both this and `sessclone_accept_invitation` are bound by it — the
  // Members page counting nothing was how an Org on a five-Seat Tier held six.
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, max_seats, sort_order)
    values ('capped', 'Capped', 10, ${await seats(fixture.acme.id)}, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${fixture.acme.id}, ${tier!.id}, 'active')
  `

  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setMemberRemoved(tx, fixture.acme.members.removed, false),
    ),
  ).rejects.toThrow(/no seat free/)

  // Freeing one makes room, and the same write then goes through.
  await asRole(fixture.acme, 'owner', (tx) =>
    setMemberRemoved(tx, fixture.acme.members.manager, true),
  )
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setMemberRemoved(tx, fixture.acme.members.removed, false),
    ),
  ).toBe(true)
})

test('a plan nobody approved sets no ceiling', async () => {
  // A sign-up's ask is an `inactive` row (ticket 118). With approval switched
  // off nobody activates it, and a Personal ask must not cap the Org at one.
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, max_seats, sort_order)
    values ('capped', 'Capped', 10, ${await seats(fixture.acme.id)}, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${fixture.acme.id}, ${tier!.id}, 'inactive')
  `

  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setMemberRemoved(tx, fixture.acme.members.removed, false),
    ),
  ).toBe(true)
})
