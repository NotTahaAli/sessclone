import { beforeEach, expect, test, vi } from 'vitest'

import { owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 121: the Org's own rates action. `org-rates.test.ts` proves the
// policy on the unprivileged role; this proves what the action checks first,
// since anybody can POST to it whether or not the page rendered a form.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({ signedInUser }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  vi.resetModules()
  signedInUser.mockReset()
})

/** A fresh module per case: `currentViewer` is `cache`d for one request. */
const actAs = async (userId: string) => {
  signedInUser.mockResolvedValue({ id: userId, email: 'whoever@example.test' })
  return import('../app/(dashboard)/settings/org/rates/actions')
}

const form = (orgId: string) => {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    orgId,
    model: 'claude-opus-4-6',
    class: 'input',
    priceUsd: '4',
    effectiveFrom: '2026-09-01',
  })) {
    data.append(key, value)
  }
  return data
}

const rows = () => sql`select org_id from org_rate_overrides`

test('an Owner adds a rate to their own Org', async () => {
  const { addOwnRateAction } = await actAs(fixture.acme.users.owner)
  expect(await addOwnRateAction(null, form(fixture.acme.id))).toEqual({
    added: 'claude-opus-4-6',
  })
  expect(await rows()).toEqual([{ org_id: fixture.acme.id }])
})

test('a Member, or another Org’s id, is refused before any statement', async () => {
  const asMember = await actAs(fixture.acme.users.member)
  expect(await asMember.addOwnRateAction(null, form(fixture.acme.id))).toEqual({
    error: 'Only an Owner or Admin may set this Org’s rates.',
  })

  const asOwner = await actAs(fixture.acme.users.owner)
  expect(
    await asOwner.addOwnRateAction(null, form(fixture.globex.id)),
  ).toHaveProperty('error')

  expect(await rows()).toEqual([])
})
