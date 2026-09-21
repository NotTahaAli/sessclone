import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import { listOrgMembers, listScopes, ownScopes, setScope } from '../lib/scopes'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 46: which Members a Manager may see.
//
// The enforcement is ticket 44's and is proved in `rls.test.ts` — this is the
// assignment and the Manager's own view of it. Every write below goes through
// the unprivileged role, so "an Admin may and a Manager may not" is the policy
// answering rather than a page's.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

/** The Scope of Acme's Manager, read as the owner: the fact, not the policy. */
const scopeOfManager = async () => {
  const rows = await sql<{ member_id: string }[]>`
    select member_id from member_scopes
     where manager_member_id = ${fixture.acme.members.manager}
  `
  return rows.map((row) => row.member_id).toSorted()
}

test('an Owner or an Admin assigns and removes; a Manager and a Member cannot', async () => {
  const assign = (
    role: 'owner' | 'admin' | 'manager' | 'member',
    on: boolean,
  ) =>
    asRole(fixture.acme, role, (tx) =>
      setScope(
        tx,
        fixture.acme.id,
        fixture.acme.members.managerWithoutScope,
        fixture.acme.members.admin,
        on,
      ),
    )

  await assign('owner', true)
  expect(
    await sql`select 1 from member_scopes where manager_member_id = ${fixture.acme.members.managerWithoutScope}`,
  ).toHaveLength(1)

  // A Manager cannot widen their own Scope, which is the assignment that would
  // matter most. The delete is refused by policy: no rows, no error.
  await assign('manager', false)
  await assign('member', false)
  expect(
    await sql`select 1 from member_scopes where manager_member_id = ${fixture.acme.members.managerWithoutScope}`,
  ).toHaveLength(1)

  await assign('admin', false)
  expect(
    await sql`select 1 from member_scopes where manager_member_id = ${fixture.acme.members.managerWithoutScope}`,
  ).toHaveLength(0)
})

test('assigning twice is not an error, so a stale page does not fail', async () => {
  const assign = () =>
    asRole(fixture.acme, 'owner', (tx) =>
      setScope(
        tx,
        fixture.acme.id,
        fixture.acme.members.manager,
        fixture.acme.members.admin,
        true,
      ),
    )

  await assign()
  await assign()

  expect(await scopeOfManager()).toEqual(
    [fixture.acme.members.member, fixture.acme.members.admin].toSorted(),
  )
})

test('a Scope cannot reach across an Org boundary', async () => {
  // The Org id here is one the caller really does administer, so the policy
  // alone would allow the row. What refuses it is the composite foreign key:
  // `(org_id, member_id)` references `members (org_id, id)`, and Globex's
  // Member is not one of Acme's. Such a row would be invisible to everyone and
  // would hand a Manager another Org's people.
  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setScope(
        tx,
        fixture.acme.id,
        fixture.acme.members.manager,
        fixture.globex.members.member,
        true,
      ),
    ),
  ).rejects.toThrow()
})

test('an Admin of one Org cannot assign inside another', async () => {
  // A refused insert raises, where a refused update or delete quietly touches
  // no rows — Postgres reports a `with check` violation and says nothing about
  // a `using` one. Both are refusals; only one of them has a message.
  await expect(
    asRole(fixture.globex, 'admin', (tx) =>
      setScope(
        tx,
        fixture.acme.id,
        fixture.acme.members.manager,
        fixture.acme.members.admin,
        true,
      ),
    ),
  ).rejects.toThrow(/row-level security/)

  expect(await scopeOfManager()).toEqual([fixture.acme.members.member])
})

test('an Admin of one Org cannot revoke inside another either', async () => {
  // The quiet half of the pair: a delete refused by `using` removes nothing
  // and raises nothing, which is why a caller must never read "no error" as
  // "it worked".
  await asRole(fixture.globex, 'admin', (tx) =>
    setScope(
      tx,
      fixture.acme.id,
      fixture.acme.members.manager,
      fixture.acme.members.member,
      false,
    ),
  )

  expect(await scopeOfManager()).toEqual([fixture.acme.members.member])
})

test('the whole Org’s Scopes come back in one query, keyed by Manager', async () => {
  // One query for the page rather than one per Manager: five Managers and a
  // query each is the query-in-a-loop this repo calls a bug.
  const scopes = await asRole(fixture.acme, 'owner', (tx) =>
    listScopes(tx, fixture.acme.id),
  )

  expect([...scopes.get(fixture.acme.members.manager)!]).toEqual([
    fixture.acme.members.member,
  ])
  // Absent rather than empty: no row is the default, and the default is empty.
  expect(scopes.has(fixture.acme.members.managerWithoutScope)).toBe(false)
})

test('a Manager sees their own Scope, and an empty one is not nothing', async () => {
  // The ticket's second criterion, and it is about trust: a Manager who cannot
  // see their Scope cannot tell a Member they were never given from a Member
  // who has reported nothing.
  const [scoped] = await asRole(fixture.acme, 'manager', (tx) => ownScopes(tx))
  expect(scoped!.members.map((member) => member.memberId)).toEqual([
    fixture.acme.members.member,
  ])

  const [empty] = await asRole(fixture.acme, 'managerWithoutScope', (tx) =>
    ownScopes(tx),
  )
  expect(empty).toBeDefined()
  expect(empty!.members).toEqual([])
})

test('a Manager cannot read another Manager’s Scope', async () => {
  await asRole(fixture.acme, 'owner', (tx) =>
    setScope(
      tx,
      fixture.acme.id,
      fixture.acme.members.managerWithoutScope,
      fixture.acme.members.admin,
      true,
    ),
  )

  const [own] = await asRole(fixture.acme, 'manager', (tx) => ownScopes(tx))

  expect(own!.members.map((member) => member.memberId)).toEqual([
    fixture.acme.members.member,
  ])
})

test('somebody who is not a Manager has no Scope section at all', async () => {
  for (const role of ['owner', 'admin', 'member'] as const) {
    // oxlint-disable-next-line no-await-in-loop -- three reads, order is clearer.
    expect(await asRole(fixture.acme, role, (tx) => ownScopes(tx))).toEqual([])
  }
})

test('the Member list keeps a removed Member, marked', async () => {
  // Their history is still in the Org, and a Scope that silently dropped them
  // would change what a past chart shows.
  const members = await asRole(fixture.acme, 'owner', (tx) =>
    listOrgMembers(tx, fixture.acme.id),
  )

  expect(members).toHaveLength(6)
  expect(members.filter((member) => member.removed)).toHaveLength(1)
})

test('the Members page is Owner or Admin, guarded on the page and not the link', () => {
  const page = readFileSync(
    new URL(
      '../app/(dashboard)/settings/org/members/page.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  expect(page).toContain('reachesOrgSettings(viewer.role)')
  expect(page).toContain('notFound()')
})
