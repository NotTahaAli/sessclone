import { beforeEach, expect, test, vi } from 'vitest'

import { seedFixture, type Fixture } from './harness'

// Ticket 62's gate, exercised rather than grepped.
//
// `navigation.test.ts` reads the files and proves the *shape*: the guard is on
// the layout, no page repeats it, and the answer comes from
// `sessclone_is_platform_admin()`. None of that fails if the guard stops
// guarding — `if (operator) notFound()` contains every string those tests look
// for. What has to be true is behavioural: an Org Owner is refused, a stranger
// is refused, the operator is not, and signed out is nobody.
//
// The one thing stubbed is who is signed in, which is Supabase's answer and
// not this repo's. Everything below it is the real database, the real policies
// and the real function.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({
  signedInUser,
  sessionUser: signedInUser,
}))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  vi.resetModules()
  signedInUser.mockReset()
})

/** A fresh module per case, because `currentOperator` is `cache`d per request. */
const operatorFor = async (userId: string | null) => {
  signedInUser.mockResolvedValue(
    userId === null ? null : { id: userId, email: 'whoever@example.test' },
  )
  const { currentOperator } = await import('../lib/platform-admin')
  return currentOperator()
}

test('the operator reaches the area', async () => {
  await expect(
    operatorFor(fixture.platformAdmin.userId),
  ).resolves.toMatchObject({ userId: fixture.platformAdmin.userId })
})

test('an Org Owner does not, which is the refusal the ticket names', async () => {
  await expect(operatorFor(fixture.acme.users.owner)).resolves.toBeNull()
})

test('a signed-in stranger does not', async () => {
  await expect(operatorFor(fixture.stranger.userId)).resolves.toBeNull()
})

test('signed out is nobody, without asking the database', async () => {
  await expect(operatorFor(null)).resolves.toBeNull()
})
