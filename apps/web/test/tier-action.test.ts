import { beforeEach, expect, test, vi } from 'vitest'

import { readMarketingTiers } from '../lib/tiers'
import { anonymous, asUser, seedFixture, type Fixture } from './harness'

// Ticket 80's and 65's write at the boundary: `saveTierAction` is the action
// that carries the cache invalidation the pricing page depends on, and until
// now the only thing standing behind "the next request sees the new price"
// was a source-text assertion — which does not go red if somebody moves the
// call above an early return.
//
// Only `next/cache` and Supabase are stubbed. The database, the policies and
// the action's own parsing are real.

const updateTag = vi.hoisted(() => vi.fn())
const revalidatePath = vi.hoisted(() => vi.fn())
const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({ signedInUser }))
vi.mock('next/cache', () => ({
  updateTag,
  revalidatePath,
  // `lib/tiers.ts` calls this at module scope of its cached function.
  cacheTag: () => {},
}))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  vi.resetModules()
  signedInUser.mockReset()
  updateTag.mockClear()
  revalidatePath.mockClear()
})

const actAs = async (userId: string) => {
  signedInUser.mockResolvedValue({ id: userId, email: 'whoever@example.test' })
  return import('../app/admin/tiers/actions')
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const TEAM = {
  key: 'team',
  name: 'Team',
  description: 'One number for all of it.',
  basePriceUsd: '',
  seatPriceUsd: '10',
  includedSeats: '0',
  minSeats: '2',
  maxSeats: '10',
  retentionMaxDays: '365',
  archivalAvailable: 'on',
  available: 'on',
  sortOrder: '2',
  features: '{"includes":["Every Device"]}',
  mode: 'create',
}

test('a saved price is what the next read of the Tiers returns', async () => {
  const actions = await actAs(fixture.platformAdmin.userId)

  expect(await actions.saveTierAction(null, form(TEAM))).toEqual({
    saved: 'Team',
  })
  await actions.saveTierAction(
    null,
    form({ ...TEAM, seatPriceUsd: '12', mode: 'edit' }),
  )

  const [tier] = await anonymous(readMarketingTiers)
  expect(tier).toMatchObject({ key: 'team', seatPriceUsd: 12 })
})

test('the save expires the pricing cache, by the tag the pages read through', async () => {
  const actions = await actAs(fixture.platformAdmin.userId)

  await actions.saveTierAction(null, form(TEAM))

  // The one thing the public pages depend on. A save that writes the row and
  // forgets this leaves every visitor on the old price until a revalidation
  // window nobody is watching.
  expect(updateTag).toHaveBeenCalledWith('tiers')
})

test('a refused save expires nothing', async () => {
  const actions = await actAs(fixture.platformAdmin.userId)
  await actions.saveTierAction(null, form(TEAM))
  updateTag.mockClear()

  // A create over an existing key is refused rather than replacing the
  // definition every Org on that Tier is entitled by.
  expect(await actions.saveTierAction(null, form(TEAM))).toEqual({
    error: 'A Tier with that key already exists — edit it below.',
  })
  expect(updateTag).not.toHaveBeenCalled()
})

test('a Tier with neither price stays "contact us" rather than becoming free', async () => {
  const actions = await actAs(fixture.platformAdmin.userId)

  await actions.saveTierAction(
    null,
    form({
      ...TEAM,
      key: 'enterprise',
      name: 'Enterprise',
      seatPriceUsd: '',
      basePriceUsd: '',
      maxSeats: '',
      retentionMaxDays: '',
    }),
  )

  const tiers = await anonymous(readMarketingTiers)
  const enterprise = tiers.find((tier) => tier.key === 'enterprise')
  // Null, not zero: `?? 0` anywhere on this path prices Enterprise at free.
  expect(enterprise).toMatchObject({
    basePriceUsd: null,
    seatPriceUsd: null,
    maxSeats: null,
    retentionMaxDays: null,
  })
})

test('nobody but a platform administrator saves a Tier', async () => {
  const actions = await actAs(fixture.acme.users.owner)

  expect(await actions.saveTierAction(null, form(TEAM))).toEqual({
    error: 'Only a platform administrator may define a Tier.',
  })
  expect(updateTag).not.toHaveBeenCalled()
  expect(await asUser(fixture.acme.users.owner, readMarketingTiers)).toEqual([])
})

test('features that are not a JSON object are refused, not stored as text', async () => {
  const actions = await actAs(fixture.platformAdmin.userId)

  expect(
    await actions.saveTierAction(null, form({ ...TEAM, features: 'nope' })),
  ).toEqual({ error: 'Features is a JSON object, or empty.' })
})
