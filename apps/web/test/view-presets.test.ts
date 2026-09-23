import { beforeEach, expect, test, vi } from 'vitest'

import { asUser, seedFixture, type Fixture } from './harness'

// Tickets 105-107: saved presets are one person's own, proven through the
// Server Actions on the unprivileged role.

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})
vi.mock('../lib/supabase/server', () => {
  const who = async () =>
    session.userId === null ? null : { id: session.userId }
  return { signedInUser: who, sessionUser: who }
})

const actions =
  await import('../app/(dashboard)/sessions/[sessionId]/transcript/preset-actions')

let fixture: Fixture
const as = (userId: string) => {
  session.userId = userId
  return actions
}

beforeEach(async () => {
  fixture = await seedFixture()
})

test('save upserts by name, and one default at a time', async () => {
  const me = as(fixture.acme.users.member)
  const first = await me.savePreset({
    name: 'Quiet',
    categories: ['user', 'assistant'],
    thinking: 'hidden',
  })
  const again = await me.savePreset({
    name: 'Quiet',
    categories: ['user'],
    thinking: 'verbose',
  })
  const loud = await me.savePreset({
    name: 'Loud',
    categories: [],
    thinking: 'collapsed',
  })
  if (!first.ok || !again.ok || !loud.ok) throw new Error('save failed')
  expect(again.value.id).toBe(first.value.id)

  expect((await me.setDefaultPreset(first.value.id)).ok).toBe(true)
  expect((await me.setDefaultPreset(loud.value.id)).ok).toBe(true)
  const list = await me.listPresets()
  expect(
    list.ok && list.value.map((p) => [p.name, p.isDefault, p.thinking]),
  ).toEqual([
    ['Loud', true, 'collapsed'],
    ['Quiet', false, 'verbose'],
  ])
})

test('bad input is refused before the database', async () => {
  const me = as(fixture.acme.users.member)
  expect(
    (
      await me.savePreset({
        name: 'x',
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the point
        categories: ['nope' as 'user'],
        thinking: 'hidden',
      })
    ).ok,
  ).toBe(false)
  expect(
    (await me.savePreset({ name: ' ', categories: [], thinking: 'hidden' })).ok,
  ).toBe(false)
  expect((await me.deletePreset('not-a-uuid')).ok).toBe(false)
})

test('another person can neither read nor change my presets', async () => {
  const mine = await as(fixture.acme.users.member).savePreset({
    name: 'Mine',
    categories: ['user'],
    thinking: 'hidden',
  })
  if (!mine.ok) throw new Error('save failed')

  const owner = as(fixture.acme.users.owner)
  expect(await owner.listPresets()).toEqual({ ok: true, value: [] })
  expect((await owner.deletePreset(mine.value.id)).ok).toBe(false)
  expect((await owner.setDefaultPreset(mine.value.id)).ok).toBe(false)

  // Straight at the table too: the policy, not the action's filter, refuses.
  const read = await asUser(
    fixture.acme.users.owner,
    (tx) => tx`select id from transcript_view_presets`,
  )
  expect(read).toHaveLength(0)
  await expect(
    asUser(
      fixture.acme.users.owner,
      (tx) => tx`
        insert into transcript_view_presets (user_id, name, categories, thinking)
        values (${fixture.acme.users.member}, 'forged', '{}', 'hidden')`,
    ),
  ).rejects.toThrow(/row-level security/)

  const still = await as(fixture.acme.users.member).listPresets()
  expect(still.ok && still.value.map((p) => [p.name, p.isDefault])).toEqual([
    ['Mine', false],
  ])
})
