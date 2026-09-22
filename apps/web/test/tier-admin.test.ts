import { beforeEach, expect, test } from 'vitest'

import { listTiers, saveTier, type TierInput } from '../lib/tier-admin'
import { setSubscription } from '../lib/subscriptions'
import { orgTier } from '../lib/tier'
import { asRole, asUser, seedFixture, type Fixture } from './harness'

// Ticket 65. What a Tier includes is data, so what is worth proving is that a
// capability change reaches an Org on the next read — no deployment, no cache
// — and that an Org's Owner can read the definition and never write it.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const asOperator = <T>(query: Parameters<typeof asUser<T>>[1]) =>
  asUser(fixture.platformAdmin.userId, query)

const TEAM: TierInput = {
  key: 'team',
  name: 'Team',
  description: 'A team that wants one number for all of it.',
  basePriceUsd: null,
  seatPriceUsd: 10,
  includedSeats: 0,
  minSeats: 2,
  maxSeats: 10,
  retentionMaxDays: 365,
  archivalAvailable: false,
  features: { manager_scopes: true },
  sortOrder: 2,
  available: true,
  mode: 'create',
}

test('a capability change reaches the Org on the next read', async () => {
  await asOperator((tx) => saveTier(tx, TEAM))
  const [tier] = await asOperator((tx) => listTiers(tx))
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId: tier!.id,
      status: 'active',
      note: null,
    }),
  )

  expect(
    await asRole(fixture.acme, 'owner', (tx) => orgTier(tx, fixture.acme.id)),
  ).toMatchObject({ archivalAvailable: false, maxSeats: 10 })

  // The edit is a row, not a release.
  await asOperator((tx) =>
    saveTier(tx, {
      ...TEAM,
      mode: 'edit',
      archivalAvailable: true,
      maxSeats: 25,
    }),
  )

  expect(
    await asRole(fixture.acme, 'owner', (tx) => orgTier(tx, fixture.acme.id)),
  ).toMatchObject({ archivalAvailable: true, maxSeats: 25 })
})

test('editing a Tier keeps its id, so the Orgs on it stay on it', async () => {
  await asOperator((tx) => saveTier(tx, TEAM))
  const [before] = await asOperator((tx) => listTiers(tx))
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId: before!.id,
      status: 'active',
      note: null,
    }),
  )

  await asOperator((tx) =>
    saveTier(tx, { ...TEAM, mode: 'edit', name: 'Team (renamed)' }),
  )

  const [after] = await asOperator((tx) => listTiers(tx))
  expect(after).toMatchObject({
    id: before!.id,
    name: 'Team (renamed)',
    // One Org is on it, which is what makes an edit worth thinking about.
    orgs: 1,
  })
})

test('null prices survive the round trip, because null is not free', async () => {
  // Both prices null is "contact us", a real Tier. A `?? 0` anywhere on the
  // way in or out turns an enterprise Tier into a free one.
  await asOperator((tx) =>
    saveTier(tx, {
      ...TEAM,
      key: 'enterprise',
      name: 'Enterprise',
      basePriceUsd: null,
      seatPriceUsd: null,
      maxSeats: null,
      retentionMaxDays: null,
    }),
  )

  const tier = (await asOperator((tx) => listTiers(tx))).find(
    (row) => row.key === 'enterprise',
  )
  expect(tier).toMatchObject({
    basePriceUsd: null,
    seatPriceUsd: null,
    maxSeats: null,
    retentionMaxDays: null,
  })
})

test('an Org Owner reads the Tiers and writes none of them', async () => {
  await asOperator((tx) => saveTier(tx, TEAM))

  expect(
    (await asRole(fixture.acme, 'owner', (tx) => listTiers(tx))).map(
      (tier) => tier.key,
    ),
  ).toContain('team')

  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      saveTier(tx, { ...TEAM, seatPriceUsd: 0 }),
    ),
  ).rejects.toThrow(/row-level security/)

  const [tier] = await asOperator((tx) => listTiers(tx))
  expect(tier!.seatPriceUsd).toBe(10)
})

test('creating a Tier cannot quietly replace one Orgs are on', async () => {
  await asOperator((tx) => saveTier(tx, TEAM))

  // The New Tier form sends `create`: a key already taken is refused, rather
  // than replacing the definition every Org on it is entitled by.
  const created = await asOperator((tx) =>
    saveTier(tx, { ...TEAM, name: 'Squatter', seatPriceUsd: 1 }),
  )
  expect(created).toBe(false)

  const [tier] = await asOperator((tx) => listTiers(tx))
  expect(tier).toMatchObject({ name: 'Team' })

  // The edit form sends `edit`, and that one does replace it.
  expect(
    await asOperator((tx) =>
      saveTier(tx, { ...TEAM, mode: 'edit', name: 'Team plus' }),
    ),
  ).toBe(true)
  const [edited] = await asOperator((tx) => listTiers(tx))
  expect(edited).toMatchObject({ name: 'Team plus' })
})
