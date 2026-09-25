import { beforeEach, expect, test, vi } from 'vitest'

import { listOrgRates } from '../lib/org-rates'
import { asUser, seedFixture, type Fixture } from './harness'

// Ticket 64's writes, at the boundary rather than one layer under it, as
// `rates-action.test.ts` does for the published price list.
//
// `org-rates.test.ts` proves what the policies do. What it cannot prove is
// what the Server Action does first — and the action is the part anybody can
// POST to whether or not a form was rendered for them.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({
  signedInUser,
  sessionUser: signedInUser,
  accountUser: signedInUser,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  vi.resetModules()
  signedInUser.mockReset()
})

/** A fresh module per case: `currentOperator` is `cache`d for one request. */
const actAs = async (userId: string) => {
  signedInUser.mockResolvedValue({ id: userId, email: 'whoever@example.test' })
  return import('../app/admin/orgs/[orgId]/rate-actions')
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const filled = () => ({
  orgId: fixture.acme.id,
  model: 'claude-opus-4-6',
  class: 'input',
  priceUsd: '3',
  effectiveFrom: '2026-09-01',
  note: 'MSA 2026-03',
})

const overrides = async () =>
  (
    await asUser(fixture.platformAdmin.userId, (tx) =>
      listOrgRates(tx, fixture.acme.id),
    )
  ).rates

test('a price that is not a number is refused rather than saved as free', async () => {
  const { addOrgRateAction } = await actAs(fixture.platformAdmin.userId)

  // Blank, whitespace, and the two literals `Number` accepts and nobody means:
  // '0x10' is 16 and '1e5' is 100000, either of which is somebody's invoice.
  const refusals = await Promise.all(
    ['', '   ', '0x10', '1e5'].map((priceUsd) =>
      addOrgRateAction(null, form({ ...filled(), priceUsd })),
    ),
  )
  for (const refusal of refusals) {
    expect(refusal).toMatchObject({ error: expect.stringContaining('Check') })
  }

  expect(await overrides()).toEqual([])
})

test('a zero price is saved when somebody actually types one', async () => {
  // Free is a real negotiated price. The rule is about the absent field.
  const { addOrgRateAction } = await actAs(fixture.platformAdmin.userId)

  expect(
    await addOrgRateAction(null, form({ ...filled(), priceUsd: '0' })),
  ).toMatchObject({ added: 'claude-opus-4-6' })

  expect((await overrides())[0]).toMatchObject({ priceUsd: 0 })
})

test('an Org Owner cannot negotiate their own price through the action', async () => {
  const { addOrgRateAction } = await actAs(fixture.acme.users.owner)

  expect(await addOrgRateAction(null, form(filled()))).toMatchObject({
    error: expect.stringContaining('platform administrator'),
  })
  expect(await overrides()).toEqual([])
})

test('the same model, class and date twice is a message, not an overwrite', async () => {
  const { addOrgRateAction } = await actAs(fixture.platformAdmin.userId)
  await addOrgRateAction(null, form(filled()))

  const again = await addOrgRateAction(
    null,
    form({ ...filled(), priceUsd: '1' }),
  )

  // Never an overwrite: that would rewrite what an already-collected Turn
  // cost. The operator deletes the row if they meant to change it.
  expect(again).toMatchObject({
    error: expect.stringContaining('already has a negotiated price'),
  })
  expect((await overrides())[0]).toMatchObject({ priceUsd: 3 })
})

test('delete reports what happened, in both directions', async () => {
  const { addOrgRateAction } = await actAs(fixture.platformAdmin.userId)
  await addOrgRateAction(null, form(filled()))
  const [saved] = await overrides()

  const asOwner = await actAs(fixture.acme.users.owner)
  expect(
    await asOwner.deleteOrgRateAction(
      null,
      form({ orgId: fixture.acme.id, rateId: saved!.id }),
    ),
  ).toMatchObject({ error: expect.stringContaining('platform administrator') })
  expect(await overrides()).toHaveLength(1)

  const asOperator = await actAs(fixture.platformAdmin.userId)
  expect(
    await asOperator.deleteOrgRateAction(
      null,
      form({ orgId: fixture.acme.id, rateId: saved!.id }),
    ),
  ).toEqual({ deleted: true })
  expect(await overrides()).toEqual([])
})
