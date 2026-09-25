import { beforeEach, expect, test, vi } from 'vitest'

import { listRates } from '../lib/rates'
import { asUser, seedFixture, type Fixture } from './harness'

// Ticket 63's writes, at the boundary rather than one layer under it.
//
// `rates-admin.test.ts` proves what the policies do. What it cannot prove is
// what the Server Action does first, and the action is the part anybody can
// POST to whether or not a form was rendered for them.
//
// Only `next/cache` and Supabase are stubbed. The database, the policies and
// the action's own code are real.

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
  return import('../app/admin/rates/actions')
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const FILLED = {
  model: 'claude-opus-9',
  class: 'input',
  effectiveFrom: '2026-01-01',
  source: '',
}

const ratesFor = async (model: string) =>
  (await asUser(fixture.platformAdmin.userId, (tx) => listRates(tx, { model })))
    .rates

test('a blank price is refused rather than published as free', async () => {
  // `z.coerce.number()` turns both '' and an absent field into 0, and a zero
  // price is worse than none: the Turn then reads as priced at nothing rather
  // than as unpriced, and quietly understates every invoice that touches the
  // model (ADR 0002).
  const { addRateAction } = await actAs(fixture.platformAdmin.userId)

  // A Server Action is a POST endpoint whether or not a form was rendered, so
  // `<input type="number">` is not the guard — and `Number('  ')` is 0.
  const refusals = await Promise.all(
    ['', '   ', '\t'].map((priceUsd) =>
      addRateAction(null, form({ ...FILLED, priceUsd })),
    ),
  )
  for (const refusal of refusals) {
    expect(refusal).toMatchObject({ error: expect.stringContaining('Check') })
  }

  expect(await ratesFor('claude-opus-9')).toEqual([])
})

test('a price of zero is published when somebody actually types one', async () => {
  // Free is a real price — a web fetch is published at $0.00 — so the rule is
  // about the absent field, not about the number.
  const { addRateAction } = await actAs(fixture.platformAdmin.userId)

  expect(
    await addRateAction(null, form({ ...FILLED, priceUsd: '0' })),
  ).toMatchObject({ added: 'claude-opus-9' })

  expect(await ratesFor('claude-opus-9')).toMatchObject([{ priceUsd: 0 }])
})

test('an Org Owner is refused by the action as well as by the policy', async () => {
  const { addRateAction, deleteRateAction } = await actAs(
    fixture.acme.users.owner,
  )

  expect(
    await addRateAction(null, form({ ...FILLED, priceUsd: '7' })),
  ).toMatchObject({ error: expect.stringContaining('platform administrator') })
  expect(
    await deleteRateAction(null, form({ rateId: crypto.randomUUID() })),
  ).toMatchObject({ error: expect.stringContaining('platform administrator') })

  expect(await ratesFor('claude-opus-9')).toEqual([])
})

test('a second price for the same model, class and date says so', async () => {
  const { addRateAction } = await actAs(fixture.platformAdmin.userId)
  await addRateAction(null, form({ ...FILLED, priceUsd: '7' }))

  expect(
    await addRateAction(null, form({ ...FILLED, priceUsd: '9' })),
  ).toMatchObject({ error: expect.stringContaining('already has a price') })

  expect(await ratesFor('claude-opus-9')).toHaveLength(1)
})

test('deleting says what happened, in both directions', async () => {
  const { addRateAction, deleteRateAction } = await actAs(
    fixture.platformAdmin.userId,
  )
  await addRateAction(null, form({ ...FILLED, priceUsd: '7' }))
  const [rate] = await ratesFor('claude-opus-9')

  expect(
    await deleteRateAction(null, form({ rateId: rate!.id })),
  ).toMatchObject({ deleted: true })
  expect(await ratesFor('claude-opus-9')).toEqual([])

  // Gone already: nothing was written, and the page says so rather than
  // claiming a second deletion.
  expect(
    await deleteRateAction(null, form({ rateId: rate!.id })),
  ).toMatchObject({ error: expect.stringContaining('not deleted') })
})
