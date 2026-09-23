import { beforeEach, expect, test, vi } from 'vitest'

import { listScopes } from '../lib/scopes'
import { asRole, seedFixture, type Fixture } from './harness'

// Ticket 46's write, at the boundary rather than one layer under it.
//
// `scopes.test.ts` proves what the policies do to `setScope`. What it cannot
// prove is what the Server Action does before it gets there, and the action is
// the part anybody can POST to: it takes the Org from the session rather than
// the form, refuses a Role that may not assign, and parses every id.
//
// Only `next/cache` and Supabase are stubbed. The database, the policies and
// the action's own code are real.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({
  signedInUser,
  sessionUser: signedInUser,
}))
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
  const { setScopeMember } =
    await import('../app/(dashboard)/settings/org/members/actions')
  return setScopeMember
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const scopeOf = async (managerMemberId: string) => {
  const scopes = await asRole(fixture.acme, 'owner', (tx) =>
    listScopes(tx, fixture.acme.id),
  )
  return scopes.get(managerMemberId) ?? new Set<string>()
}

test('an Owner assigns a Member to a Manager', async () => {
  const act = await actAs(fixture.acme.users.owner)

  await act(
    form({
      managerMemberId: fixture.acme.members.managerWithoutScope,
      memberId: fixture.acme.members.member,
      to: 'on',
    }),
  )

  expect([
    ...(await scopeOf(fixture.acme.members.managerWithoutScope)),
  ]).toEqual([fixture.acme.members.member])
})

test('a Manager cannot assign, and gets an answer rather than an error page', async () => {
  // The Role is checked in the action as well as in the policy, because the
  // two refusals are not symmetric: the insert would raise out of the action
  // into an error boundary while the delete would quietly do nothing.
  const act = await actAs(fixture.acme.users.manager)

  await expect(
    act(
      form({
        managerMemberId: fixture.acme.members.manager,
        memberId: fixture.acme.members.owner,
        to: 'on',
      }),
    ),
  ).resolves.toBeUndefined()

  expect(await scopeOf(fixture.acme.members.manager)).not.toContain(
    fixture.acme.members.owner,
  )
})

test("an Admin of another Org cannot reach into this one's Scopes", async () => {
  // The Org is the viewer's own, taken from the session — there is no field to
  // put another Org's id in. The composite foreign keys are the backstop.
  const act = await actAs(fixture.globex.users.admin)

  // Refused, whether loudly or quietly: the Org id the action uses is Globex's
  // and the Manager is Acme's, so the composite foreign key has nothing to
  // point at. What matters is the Scope afterwards.
  await act(
    form({
      managerMemberId: fixture.acme.members.managerWithoutScope,
      memberId: fixture.acme.members.member,
      to: 'on',
    }),
  ).catch(() => {})

  expect(await scopeOf(fixture.acme.members.managerWithoutScope)).toEqual(
    new Set(),
  )
})

test('a malformed id is refused before it reaches a statement', async () => {
  const act = await actAs(fixture.acme.users.owner)

  await expect(
    act(
      form({
        managerMemberId: 'not-a-uuid',
        memberId: fixture.acme.members.member,
        to: 'on',
      }),
    ),
  ).resolves.toBeUndefined()
})
