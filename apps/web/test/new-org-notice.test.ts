import { readFileSync } from 'node:fs'

import { beforeEach, afterEach, expect, test, vi } from 'vitest'

// Ticket 136: "New Org" emails the platform admins exactly as a sign-up does
// (ticket 120) — after the transaction commits, and never with approval off
// or once the Org is active. `test/signup-notice.test.ts` covers what the
// notice says; this covers only that `createOrg` triggers it the same way
// `ensureOrgForSigner`'s caller does.

let claims: { sub: string; email: string } | null = null
const jar = new Map<string, string>()

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: claims ? { claims } : null }) },
  }),
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}))
vi.mock('next/cache', () => ({
  revalidatePath: () => {},
  cacheTag: () => {},
  cacheLife: () => {},
}))
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})
// Only the plan bounds `createOrg` reads off a Tier; the marketing copy
// itself (`'use cache'`, a database read) is not what this test is about.
vi.mock('../lib/tiers', () => ({
  marketingTiers: async () => [{ key: 'team', minSeats: null, maxSeats: null }],
}))

const afterCallbacks: Array<() => unknown> = []
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback)
  },
}))

const notifySignup = vi.fn(
  async (_userId: string, _orgId: string) => 'not-configured' as const,
)
vi.mock('../lib/signup-notice', () => ({ notifySignup }))

const { seedFixture, owner: sql } = await import('./harness')

const TIER_SEED = new URL(
  '../../../supabase/migrations/20260922050000_tier_seed.sql',
  import.meta.url,
)

let fixture: Awaited<ReturnType<typeof seedFixture>>

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  jar.clear()
  afterCallbacks.length = 0
  notifySignup.mockClear()
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(TIER_SEED, 'utf8'))
  // Acme itself must not be waiting, or the Owner already has one Org
  // pending and `createOwnOrg` refuses a second before notice ever comes up.
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    select ${fixture.acme.id}, id, 'active' from tiers where key = 'team'
  `
  claims = { sub: fixture.acme.users.owner, email: 'owner@acme.test' }
})

afterEach(() => vi.unstubAllEnvs())

const form = (name: string) => {
  const data = new FormData()
  data.set('name', name)
  data.set('plan', 'team')
  data.set('seats', '3')
  return data
}

/** Runs whatever `createOrg` scheduled with `after()`, as Next would once the
 * response is sent. */
const runAfterWork = async () => {
  const queued = afterCallbacks.splice(0)
  await Promise.all(queued.map((callback) => callback()))
}

test('an Org waiting for approval notifies the platform admins, like a sign-up', async () => {
  vi.stubEnv('SIGNUP_APPROVAL', 'on')
  const { createOrg } = await import('../app/(dashboard)/org-actions')

  await expect(createOrg(null, form('Side Project'))).rejects.toThrow(
    /NEXT_REDIRECT/,
  )
  await runAfterWork()

  expect(notifySignup).toHaveBeenCalledTimes(1)
  const [userId, calledOrgId] = notifySignup.mock.calls[0]!
  expect(userId).toBe(fixture.acme.users.owner)
  expect(typeof calledOrgId).toBe('string')
})

test('approval off: opens at once and never notifies anybody', async () => {
  vi.stubEnv('SIGNUP_APPROVAL', 'off')
  const { createOrg } = await import('../app/(dashboard)/org-actions')

  await expect(createOrg(null, form('Plain'))).rejects.toThrow(/NEXT_REDIRECT/)
  await runAfterWork()

  expect(notifySignup).not.toHaveBeenCalled()
})
