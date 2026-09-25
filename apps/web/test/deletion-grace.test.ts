import { beforeEach, expect, test, vi } from 'vitest'

import { requestOwnDeletion } from '../lib/account-deletion'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 141, from review: a person in their deletion grace is signed out
// everywhere but the page that offers Keep, whether or not they still hold a
// membership. Only Supabase's JWT check is stubbed; the reads are real.

let claims: { sub: string; email: string } | null = null
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: claims ? { claims } : null }) },
  }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    set: () => {},
  }),
}))
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})

let fixture: Fixture

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  fixture = await seedFixture()
})

const server = () => import('../lib/supabase/server')

test('a person in their grace is nobody to sessionUser, and still themselves to Keep', async () => {
  const person = fixture.acme.users.member
  claims = { sub: person, email: 'member@acme.test' }
  const { sessionUser, realSessionUser, accountUser, signedInUser } =
    await server()
  expect(await sessionUser()).not.toBeNull()

  await asUser(person, requestOwnDeletion)
  expect(await sessionUser()).toBeNull()
  expect(await realSessionUser()).toBeNull()
  expect(await signedInUser()).toBeNull()
  expect((await accountUser())?.id).toBe(person)
})

test('with no live membership, the grace still locks', async () => {
  const [row] = await sql<{ id: string }[]>`
    insert into users (email) values ('alone@nowhere.test') returning id
  `
  claims = { sub: row!.id, email: 'alone@nowhere.test' }
  await asUser(row!.id, requestOwnDeletion)
  const { viewerLocked } = await import('../lib/viewer')
  expect(await viewerLocked()).toBe(true)
  expect(await (await server()).sessionUser()).toBeNull()
})
