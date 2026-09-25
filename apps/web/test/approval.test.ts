import { afterEach, expect, test, vi } from 'vitest'

import { approvalRequired, isLocked } from '../lib/approval'
import { owner as sql, seedFixture } from './harness'

// Ticket 119: which statuses lock an Org, and the one switch that unlocks all
// of them. The vitest config sets `SIGNUP_APPROVAL=off` so suites about
// something else run as before; each test here sets it itself.

afterEach(() => {
  vi.unstubAllEnvs()
})

test('on unless it is switched off, self-hosted deployments included', () => {
  vi.stubEnv('SIGNUP_APPROVAL', undefined)
  expect(approvalRequired()).toBe(true)
  vi.stubEnv('SIGNUP_APPROVAL', 'on')
  expect(approvalRequired()).toBe(true)
  vi.stubEnv('SIGNUP_APPROVAL', ' OFF ')
  expect(approvalRequired()).toBe(false)
})

test('inactive, no row and cancelled lock; active and past due do not', () => {
  vi.stubEnv('SIGNUP_APPROVAL', undefined)
  expect(isLocked('inactive')).toBe(true)
  expect(isLocked(null)).toBe(true)
  expect(isLocked('cancelled')).toBe(true)
  expect(isLocked('active')).toBe(false)
  expect(isLocked('past_due')).toBe(false)
})

test('switched off, nothing locks', () => {
  vi.stubEnv('SIGNUP_APPROVAL', 'off')
  expect(isLocked('inactive')).toBe(false)
  expect(isLocked(null)).toBe(false)
  expect(isLocked('cancelled')).toBe(false)
})

// The lock at the Server Action boundary. A locked Org sees only the waiting
// page, but an action is a POST anybody can make whether or not a form was
// rendered for them, so the refusal lives where every dashboard action learns
// who is asking (`signedInUser`, `currentViewer`) rather than in each action.
// Retention stands in for all of them. Only Supabase's JWT check is stubbed:
// the gate, the viewer read and the write are the real ones, as
// `sessclone_app`.

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
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})

test('a locked Org cannot POST its own settings; active and past due can', async () => {
  vi.stubEnv('SIGNUP_APPROVAL', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  const fixture = await seedFixture()
  claims = { sub: fixture.acme.users.owner, email: 'owner@example.test' }
  const { setRetention } =
    await import('../app/(dashboard)/settings/org/actions')
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name) values ('team', 'Team') returning id
  `
  const retain = (days: string) => {
    const form = new FormData()
    form.append('days', days)
    form.append('orgId', fixture.acme.id)
    return setRetention(null, form)
  }
  const refused = { error: 'Sign in again to change retention.' }

  // No subscription row: the state every Org is born in.
  expect(await retain('30')).toEqual(refused)
  for (const status of ['inactive', 'cancelled'] as const) {
    // eslint-disable-next-line no-await-in-loop -- one status at a time, so a failure names which
    await sql`
      insert into subscriptions (org_id, tier_id, status)
      values (${fixture.acme.id}, ${tier!.id}, ${status})
      on conflict (org_id) do update set status = excluded.status
    `
    // eslint-disable-next-line no-await-in-loop -- as above
    expect(await retain('30'), status).toEqual(refused)
  }
  const [row] = await sql<{ retention_days: number }[]>`
    select retention_days from orgs where id = ${fixture.acme.id}
  `
  expect(row!.retention_days).toBe(90)

  for (const [status, days] of [
    ['active', 30],
    ['past_due', 31],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop -- as above
    await sql`
      update subscriptions set status = ${status}
       where org_id = ${fixture.acme.id}
    `
    // eslint-disable-next-line no-await-in-loop -- as above
    expect(await retain(String(days)), status).toEqual({ saved: days })
  }
})
