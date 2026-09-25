import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { resolveCaller } from '../lib/collector-auth'
import {
  DEMO_COOKIE,
  DEMO_REFUSAL,
  DEMO_USER_ID,
  DemoRefusal,
} from '../lib/demo'
import { DEMO_ORGS, demoCutoff, demoId, demoWindow } from '../lib/demo-data'
import { ensureDemo, refreshDemo, type DemoStore } from '../lib/demo-refresh'
import { hashApiKey } from '../lib/api-keys'
import { listOrgs, pendingOrgCount } from '../lib/subscriptions'
import { listTiers } from '../lib/tier-admin'
import { asUser, owner as sql, seedFixture } from './harness'

// Ticket 137: the demo, against a real Postgres with the real migrations.
//
// `lib/db.ts` is the real one here, pointed at `sessclone_app`: the demo's
// read-only guarantee lives in `asViewer` itself, so stubbing it (as the
// other action tests do) would prove nothing about it.

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
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

// A backfill is 60 days of two Orgs: seconds, not the default five.
vi.setConfig({ testTimeout: 60_000 })

const NIGHT = new Date('2026-09-25T23:30:00Z')
const NORTHWIND = demoId('org:northwind')
const HARBOR = demoId('org:harbor')

/** Records what would have gone to storage. */
const recorder = () => {
  const put = new Map<string, string>()
  const removed: string[] = []
  const store: DemoStore = {
    put: async (key, body) => void put.set(key, body),
    remove: async (keys) => void removed.push(...keys),
  }
  return { store, put, removed }
}

const count = async (table: 'turns' | 'log_artifacts' | 'session_events') =>
  Number(
    (
      await sql<{ n: string }[]>`
        select count(*) as n from ${sql(table)}
         where org_id in ${sql([NORTHWIND, HARBOR])}
      `
    )[0]!.n,
  )

beforeAll(() => {
  vi.stubEnv('DATABASE_URL', process.env.APP_DATABASE_URL)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  vi.stubEnv('DEMO', 'on')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  claims = null
  jar.clear()
  await sql`
    insert into tiers (key, name, retention_max_days, max_seats, sort_order)
    values ('team', 'Team', 365, 10, 2)
  `
})

const enterDemo = () => jar.set(DEMO_COOKIE, '1')

/** When `turns` was last analysed, as a number that only grows. */
const analysed = async () =>
  (
    await sql<{ at: Date | null }[]>`
      select last_analyze as at from pg_stat_user_tables
       where relname = 'turns'
    `
  )[0]!.at?.getTime() ?? 0

/** The demo's Orgs and people without 60 days of Turns: what every test but
 * the two about seeded data needs, in milliseconds rather than seconds. */
const createDemo = () => sql.begin((tx) => ensureDemo(tx))

test('the refresh backfills the window, is idempotent, and prunes past 60 days', async () => {
  const before = await analysed()
  const first = recorder()
  const done = await refreshDemo(sql, first.store, NIGHT)
  // A backfill leaves the planner statistics for what it wrote: without
  // them the Costs page took 99s until autovacuum caught up.
  expect(await analysed()).toBeGreaterThan(before)

  expect(done!.seeded).toBe(DEMO_ORGS.length * 60)
  const turns = await count('turns')
  const artifacts = await count('log_artifacts')
  expect(turns).toBeGreaterThan(10_000)
  expect(artifacts).toBe(first.put.size)
  expect(artifacts).toBeGreaterThan(10)
  // Every object is small, and the lot is in the hundreds of kilobytes.
  const bytes = [...first.put.values()].reduce((n, b) => n + b.length, 0)
  expect(bytes).toBeLessThan(500_000)

  // Again, same moment: nothing new, nothing lost.
  const again = recorder()
  await refreshDemo(sql, again.store, NIGHT)
  expect(await count('turns')).toBe(turns)
  expect(await count('log_artifacts')).toBe(artifacts)
  expect(again.removed).toEqual([])

  // Ten days on: ten days seeded per Org, ten pruned, and the transcripts
  // of the pruned days deleted from storage with their rows.
  const later = new Date(NIGHT.getTime() + 10 * 86_400_000)
  const cutoff = demoCutoff(later)
  const [doomed] = await sql<{ keys: string[] }[]>`
    select coalesce(array_agg(storage_key), '{}') as keys from log_artifacts
     where org_id in ${sql([NORTHWIND, HARBOR])} and created_at < ${cutoff}
  `
  const moved = recorder()
  const next = await refreshDemo(sql, moved.store, later)
  expect(next!.seeded).toBe(DEMO_ORGS.length * 10)
  expect(next!.pruned).toBeGreaterThan(0)
  expect(moved.removed.toSorted()).toEqual(doomed!.keys.toSorted())
  expect(doomed!.keys.length).toBeGreaterThan(0)

  const [span] = await sql<{ oldest: Date; days: string }[]>`
    select min(occurred_at) as oldest,
           count(distinct (org_id, (occurred_at at time zone 'UTC')::date)) as days
      from turns where org_id in ${sql([NORTHWIND, HARBOR])}
  `
  expect(span!.oldest.getTime()).toBeGreaterThanOrEqual(cutoff.getTime())
  expect(Number(span!.days)).toBeLessThanOrEqual(DEMO_ORGS.length * 60)
  expect(demoWindow(later)).toHaveLength(60)
  const [events] = await sql<{ n: string }[]>`
    select count(*) as n from session_events
     where org_id in ${sql([NORTHWIND, HARBOR])} and occurred_at < ${cutoff}
  `
  expect(Number(events!.n)).toBe(0)
})

test('the demo visitor sees the demo Orgs and nothing else, as Owner of one', async () => {
  const fixture = await seedFixture()
  await sql`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at)
    values (${fixture.acme.id}, ${fixture.acme.members.owner}, 's', 'm', now())
  `
  await refreshDemo(sql, null, NIGHT)
  enterDemo()
  const { sessionViewer } = await import('../lib/viewer')
  const { asViewer } = await import('../lib/db')

  const viewer = await sessionViewer()
  expect(viewer).toMatchObject({
    userId: DEMO_USER_ID,
    orgId: NORTHWIND,
    role: 'owner',
  })

  const [orgs, turnOrgs] = await asViewer(DEMO_USER_ID, (tx) =>
    Promise.all([
      tx<{ id: string }[]>`select id from orgs order by id`,
      tx<
        { org_id: string }[]
      >`select distinct org_id from turns order by org_id`,
    ]),
  )
  const both = [NORTHWIND, HARBOR].toSorted()
  expect(orgs.map((row) => row.id)).toEqual(both)
  expect(turnOrgs.map((row) => row.org_id)).toEqual(both)
})

test('the demo is off unless DEMO=on, and a real session always wins', async () => {
  const fixture = await seedFixture()
  await createDemo()
  enterDemo()
  const { sessionViewer } = await import('../lib/viewer')
  const { sessionUser } = await import('../lib/supabase/server')

  // Signed in with the demo cookie still set: their own Org.
  claims = { sub: fixture.acme.users.owner, email: 'owner@acme.test' }
  expect((await sessionViewer())?.orgId).toBe(fixture.acme.id)

  claims = null
  vi.stubEnv('DEMO', 'off')
  expect(await sessionUser()).toBeNull()
})

test('switching between the two demo Orgs works, and lands as a Member', async () => {
  await createDemo()
  enterDemo()
  const { switchOrg } = await import('../app/(dashboard)/org-actions')
  const { sessionViewer, MEMBER_COOKIE } = await import('../lib/viewer')
  const form = new FormData()
  form.append('memberId', demoId('member:harbor:0'))

  await expect(switchOrg(null, form)).rejects.toThrow(/NEXT_REDIRECT/)
  expect(jar.get(MEMBER_COOKIE)).toBe(demoId('member:harbor:0'))
  expect(await sessionViewer()).toMatchObject({ orgId: HARBOR, role: 'member' })
})

test('every write as the demo visitor is refused by the database', async () => {
  await createDemo()
  const { asViewer } = await import('../lib/db')
  const member = demoId('member:northwind:0')

  const writes = [
    (tx: Parameters<Parameters<typeof asViewer>[1]>[0]) =>
      tx`update orgs set name = 'Mine now' where id = ${NORTHWIND}`,
    (tx: Parameters<Parameters<typeof asViewer>[1]>[0]) =>
      tx`update users set display_name = 'x' where id = ${DEMO_USER_ID}`,
    (tx: Parameters<Parameters<typeof asViewer>[1]>[0]) =>
      tx`insert into api_keys (member_id, label, key_hash, key_prefix)
         values (${member}, 'k', ${'f'.repeat(64)}, 'sc_demo')`,
    (tx: Parameters<Parameters<typeof asViewer>[1]>[0]) =>
      tx`delete from log_artifacts where member_id = ${member}`,
    (tx: Parameters<Parameters<typeof asViewer>[1]>[0]) =>
      tx`insert into orgs (name) values ('Another')`,
    (tx: Parameters<Parameters<typeof asViewer>[1]>[0]) =>
      tx`update members set role = 'member' where id = ${member}`,
  ]
  for (const write of writes) {
    // oxlint-disable-next-line no-await-in-loop -- each its own transaction.
    const refused = await asViewer(DEMO_USER_ID, write).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(DemoRefusal)
  }
  // The same statement as a real Owner is not read-only: the refusal is the
  // demo's, not the policy's.
  const fixture = await seedFixture()
  await expect(
    asViewer(
      fixture.acme.users.owner,
      (tx) =>
        tx`update orgs set name = 'Renamed' where id = ${fixture.acme.id}`,
    ),
  ).resolves.toBeDefined()
})

test('the actions say "This is a demo" rather than their own refusals', async () => {
  await createDemo()
  enterDemo()
  const { setTimezone } =
    await import('../app/(dashboard)/settings/org/actions')
  const { createKey } = await import('../app/(dashboard)/keys/actions')
  const { leaveCurrentOrg } = await import('../app/(dashboard)/org-actions')
  const { setArchival } =
    await import('../app/(dashboard)/settings/you/actions')

  const form = new FormData()
  form.append('orgId', NORTHWIND)
  form.append('timezone', 'Europe/London')
  form.append('label', 'laptop')
  form.append('memberId', demoId('member:northwind:0'))
  form.append('to', 'off')

  expect(await setTimezone(null, form)).toEqual({ error: DEMO_REFUSAL })
  expect(await createKey(null, form)).toEqual({ error: DEMO_REFUSAL })
  expect(await leaveCurrentOrg(null, form)).toEqual({ error: DEMO_REFUSAL })
  // An action with no error channel meets the database's refusal instead,
  // which the error boundary shows as the same sentence.
  await expect(setArchival(form)).rejects.toBeInstanceOf(DemoRefusal)

  const [org] = await sql<{ timezone: string }[]>`
    select timezone from orgs where id = ${NORTHWIND}
  `
  expect(org!.timezone).toBe('UTC')
})

test('ingest refuses a demo Org’s key', async () => {
  const fixture = await seedFixture()
  await createDemo()
  vi.stubEnv('SIGNUP_APPROVAL', 'off')
  await sql`
    insert into api_keys (member_id, label, key_hash, key_prefix) values
      (${demoId('member:northwind:1')}, 'demo', ${hashApiKey('sc_demo_key')}, 'sc_demo'),
      (${fixture.acme.members.owner}, 'real', ${hashApiKey('sc_real_key')}, 'sc_real')
  `

  expect(await resolveCaller(sql, 'sc_demo_key')).toBeUndefined()
  expect(await resolveCaller(sql, 'sc_real_key')).toMatchObject({
    orgId: fixture.acme.id,
  })
})

test('the dashboard role can neither mark nor unmark a demo Org', async () => {
  const fixture = await seedFixture()
  await createDemo()

  await expect(
    asUser(
      fixture.acme.users.owner,
      (tx) => tx`update orgs set is_demo = true where id = ${fixture.acme.id}`,
    ),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    asUser(
      fixture.acme.users.owner,
      (tx) => tx`insert into orgs (name, is_demo) values ('Sneaky', true)`,
    ),
  ).rejects.toMatchObject({ code: '42501' })
  await expect(
    // The demo's own Owner, outside the read-only guard: the trigger alone.
    asUser(
      DEMO_USER_ID,
      (tx) => tx`update orgs set is_demo = false where id = ${NORTHWIND}`,
    ),
  ).rejects.toMatchObject({ code: '42501' })
})

test('the Admin panel does not count the demo Orgs as customers', async () => {
  const fixture = await seedFixture()
  await createDemo()
  // Waiting for approval, as a demo Org would be if its row went missing.
  await sql`update subscriptions set status = 'inactive' where org_id = ${HARBOR}`

  const [listed, pending, tiers] = await asUser(
    fixture.platformAdmin.userId,
    (tx) => Promise.all([listOrgs(tx), pendingOrgCount(tx), listTiers(tx)]),
  )
  const ids = listed.orgs.map((org) => org.id)
  expect(ids).toContain(fixture.acme.id)
  expect(ids).not.toContain(NORTHWIND)
  expect(ids).not.toContain(HARBOR)
  // Acme and Globex have no subscription: they are the two waiting.
  expect(pending).toBe(2)
  expect(tiers.find((tier) => tier.key === 'team')!.orgs).toBe(0)
})

test('/demo sets the cookie and stays on the host it was asked on', async () => {
  const route = await import('../app/demo/route')
  // As a request arrives behind a proxy: the server's own host, not the
  // browser's.
  const GET = () =>
    (route.GET as (request: NextRequest) => Response)(
      new NextRequest('http://localhost:3000/demo'),
    )

  const response = GET()
  expect(response.status).toBe(307)
  // Relative: behind a proxy the server's idea of its host is not the
  // browser's, and a redirect there arrives without the cookie.
  expect(response.headers.get('location')).toBe('/costs')
  expect(response.headers.get('set-cookie')).toMatch(
    /^sessclone-demo=1;.*HttpOnly/i,
  )
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')

  vi.stubEnv('DEMO', 'off')
  expect(GET().status).toBe(404)
})
