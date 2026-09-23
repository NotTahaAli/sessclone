import { beforeEach, expect, test, vi } from 'vitest'

import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
  type FixtureRole,
} from './harness'
import { renameOrg, setOrgOperatorName } from '../lib/names'
import {
  adminOrg,
  listOrgs,
  setSubscription,
  subscriptionHistory,
} from '../lib/subscriptions'

// Tickets 100 to 102: the name a person set reaching the surfaces that still
// printed their address, an Org renamed by its own Owner or Admin, and a name
// for an Org that only platform administrators see.
//
// Every write and read runs as `sessclone_app`, the only connection a policy
// applies to. The one stub is who Supabase says is signed in.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({ signedInUser }))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  vi.resetModules()
  signedInUser.mockReset()
})

const signIn = (id: string) =>
  signedInUser.mockResolvedValue({ id, email: 'whoever@example.test' })

const nameUser = (id: string, name: string) =>
  sql`update users set display_name = ${name} where id = ${id}`

// --- Ticket 100: the name, where the address was ------------------------

test('the account menu reads the display name, not only the address', async () => {
  await nameUser(fixture.acme.users.owner, 'Taha')
  signIn(fixture.acme.users.owner)

  const { currentViewer } = await import('../lib/viewer')
  await expect(currentViewer()).resolves.toMatchObject({ displayName: 'Taha' })
})

test('the admin frame reads the operator’s display name', async () => {
  await nameUser(fixture.platformAdmin.userId, 'Ops Taha')
  signIn(fixture.platformAdmin.userId)

  const { currentOperator } = await import('../lib/platform-admin')
  await expect(currentOperator()).resolves.toMatchObject({ name: 'Ops Taha' })
})

test('a subscription event names its actor by display name', async () => {
  await nameUser(fixture.platformAdmin.userId, 'Ops Taha')
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd)
    values ('team', 'Team', 10) returning id
  `

  const history = await asUser(fixture.platformAdmin.userId, async (tx) => {
    await setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId: tier!.id,
      status: 'active',
      note: null,
    })
    return subscriptionHistory(tx, fixture.acme.id)
  })

  expect(history[0]?.actorEmail).toBe('Ops Taha')
})

// --- Ticket 101: an Org renamed by its own ------------------------------

const rename = (who: FixtureRole, name: string) =>
  asRole(fixture.acme, who, (tx) => renameOrg(tx, fixture.acme.id, name))

const orgName = async () => {
  const [row] = await sql<{ name: string }[]>`
    select name from orgs where id = ${fixture.acme.id}
  `
  return row!.name
}

test('an Owner and an Admin may rename the Org', async () => {
  expect(await rename('owner', 'Acme Ltd')).toBe(true)
  expect(await orgName()).toBe('Acme Ltd')
  expect(await rename('admin', 'Acme Group')).toBe(true)
  expect(await orgName()).toBe('Acme Group')
})

test('a Manager and a Member may not, and the refusal writes nothing', async () => {
  const before = await orgName()
  expect(await rename('manager', 'Hijacked')).toBe(false)
  expect(await rename('member', 'Hijacked')).toBe(false)
  expect(await orgName()).toBe(before)
})

// --- Ticket 102: an Org's admin-only name -------------------------------

const asOperator = <T>(query: Parameters<typeof asUser<T>>[1]) =>
  asUser(fixture.platformAdmin.userId, query)

test('the operator names an Org, and sees it on the list and the page', async () => {
  await asOperator((tx) => setOrgOperatorName(tx, fixture.acme.id, 'Pilot'))

  const org = await asOperator((tx) => adminOrg(tx, fixture.acme.id))
  expect(org).toMatchObject({ name: fixture.acme.name, operatorName: 'Pilot' })

  // The filter finds it by the name only the operator knows it by.
  const { orgs } = await asOperator((tx) => listOrgs(tx, { name: 'pilo' }))
  expect(orgs.map((row) => row.id)).toEqual([fixture.acme.id])
})

test('the Org’s own Owner neither reads nor writes it', async () => {
  await asOperator((tx) => setOrgOperatorName(tx, fixture.acme.id, 'Pilot'))

  const seen = await asRole(fixture.acme, 'owner', (tx) =>
    adminOrg(tx, fixture.acme.id),
  )
  expect(seen?.operatorName).toBeNull()
  expect(
    await asRole(
      fixture.acme,
      'owner',
      (tx) => tx`select * from org_operator_names`,
    ),
  ).toHaveLength(0)

  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setOrgOperatorName(tx, fixture.acme.id, 'Mine now'),
    ),
  ).rejects.toThrow(/row-level security/)
})

test('clearing the admin name removes the row', async () => {
  await asOperator((tx) => setOrgOperatorName(tx, fixture.acme.id, 'Pilot'))
  await asOperator((tx) => setOrgOperatorName(tx, fixture.acme.id, null))

  const org = await asOperator((tx) => adminOrg(tx, fixture.acme.id))
  expect(org?.operatorName).toBeNull()
  expect(await sql`select 1 from org_operator_names`).toHaveLength(0)
})
