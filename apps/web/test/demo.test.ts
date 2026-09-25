import { NextRequest } from 'next/server'
import type postgres from 'postgres'
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
    auth: {
      getClaims: async () => ({ data: claims ? { claims } : null }),
      exchangeCodeForSession: async () => ({ error: null }),
      signInWithOAuth: async () => ({
        data: { url: 'https://github.test/login' },
        error: null,
      }),
      signOut: async () => ({ error: null }),
    },
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
const nextCache = vi.hoisted(() => ({
  revalidatePath: () => {},
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}))
vi.mock('next/cache', () => nextCache)

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
  vi.stubEnv('ENABLE_DEMO', 'true')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test')
  claims = null
  jar.clear()
  vi.clearAllMocks()
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

  // Again, same moment: nothing new, nothing lost, and no day generated a
  // second time. The transaction is watched to read the limits it ran under.
  const again = recorder()
  let limits: { statement: string; idle: string } | undefined
  // Only `begin` is used by the refresh; the rest is the real client.
  const watched: typeof sql = Object.assign(Object.create(sql), {
    begin: (run: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      sql.begin(async (tx) => {
        const out = await run(tx)
        ;[limits] = await tx<{ statement: string; idle: string }[]>`
          select current_setting('statement_timeout') as statement,
                 current_setting('idle_in_transaction_session_timeout') as idle
        `
        return out
      }),
  })
  expect((await refreshDemo(watched, again.store, NIGHT))!.seeded).toBe(0)
  // A hung statement or a stalled PUT cannot hold the lock indefinitely.
  expect(limits).toEqual({ statement: '1min', idle: '1min' })
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

test('the demo is off unless ENABLE_DEMO=true, and a real session always wins', async () => {
  const fixture = await seedFixture()
  await createDemo()
  enterDemo()
  const { sessionViewer } = await import('../lib/viewer')
  const { sessionUser } = await import('../lib/supabase/server')

  // Signed in with the demo cookie still set: their own Org.
  claims = { sub: fixture.acme.users.owner, email: 'owner@acme.test' }
  expect((await sessionViewer())?.orgId).toBe(fixture.acme.id)

  claims = null
  vi.stubEnv('ENABLE_DEMO', 'false')
  expect(await sessionUser()).toBeNull()
  // Ticket 138 renamed it: the old spelling turns nothing on.
  vi.stubEnv('ENABLE_DEMO', undefined)
  vi.stubEnv('ENABLE_DEMO', 'true')
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
  // A search as well: an operator name only matches inside the demo filter.
  await sql`insert into org_operator_names (org_id, name) values (${HARBOR}, 'Harbor Ops')`
  const searched = await asUser(fixture.platformAdmin.userId, (tx) =>
    listOrgs(tx, { name: 'Harbor' }),
  )
  expect(searched.orgs).toEqual([])
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

  vi.stubEnv('ENABLE_DEMO', 'false')
  expect(GET().status).toBe(404)
})

test('the refresh stops before touching an Org that holds a demo id but is not a demo', async () => {
  // As if a real Org had been given the id: nothing of it may be pruned or
  // seeded, and the refresh must say so rather than carry on.
  await sql`insert into orgs (id, name) values (${NORTHWIND}, 'Somebody real')`
  await expect(refreshDemo(sql, null, NIGHT)).rejects.toThrow(/not a demo/)
  expect(await count('turns')).toBe(0)
  const [org] = await sql<{ name: string; is_demo: boolean }[]>`
    select name, is_demo from orgs where id = ${NORTHWIND}
  `
  expect(org).toEqual({ name: 'Somebody real', is_demo: false })
})

test('no gap between storage PUTs leaves the transaction idle past its limit', async () => {
  // `idle_in_transaction_session_timeout` counts from the last statement, so
  // back-to-back PUTs of up to 10s each would add up past its 60s and kill
  // the refresh after the bytes went up. Each PUT must start just after a
  // statement: the refresh backend's `state_change` moves before every one.
  // As text: microseconds, which a Date would round to the same millisecond.
  const seen: string[] = []
  const store: DemoStore = {
    put: async () => {
      const [row] = await sql<{ at: string }[]>`
        select state_change::text as at from pg_stat_activity
         where pid in (select pid from pg_locks
                        where locktype = 'advisory' and granted and objsubid = 1
                          and (classid::bigint << 32 | objid::bigint)
                            = hashtext('sessclone_demo_refresh'))
           and state = 'idle in transaction'
      `
      seen.push(row!.at)
    },
    remove: async () => {},
  }
  await refreshDemo(sql, store, NIGHT)
  expect(seen.length).toBeGreaterThan(1)
  expect(new Set(seen).size).toBe(seen.length)
})

test('the storage PUT gives up rather than hanging the refresh', async () => {
  const { presignedStore } = await import('../lib/demo-refresh')
  vi.stubEnv('STORAGE_ENDPOINT', 'https://storage.test')
  vi.stubEnv('STORAGE_BUCKET', 'b')
  vi.stubEnv('STORAGE_ACCESS_KEY_ID', 'k')
  vi.stubEnv('STORAGE_SECRET_ACCESS_KEY', 's')
  let signal: AbortSignal | null | undefined
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    signal = init.signal
    return new Response(null, { status: 200 })
  })
  try {
    await presignedStore.put('demo/key', '{}')
  } finally {
    vi.unstubAllGlobals()
    vi.stubEnv('STORAGE_ENDPOINT', '')
  }
  expect(signal).toBeInstanceOf(AbortSignal)
})

test('the refresh route: a secret, then ENABLE_DEMO, then one at a time', async () => {
  const { GET } = await import('../app/api/demo/refresh/route')
  const call = (bearer?: string) =>
    GET(
      new Request('https://app.test/api/demo/refresh', {
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      }),
    )

  vi.stubEnv('CRON_SECRET', '')
  expect((await call('anything')).status).toBe(503)

  vi.stubEnv('CRON_SECRET', 'the-secret')
  expect((await call('wrong')).status).toBe(401)
  expect((await call()).status).toBe(401)

  vi.stubEnv('ENABLE_DEMO', 'false')
  const off = await call('the-secret')
  expect(off.status).toBe(200)
  expect(await off.json()).toEqual({ demo: 'off' })

  vi.stubEnv('ENABLE_DEMO', 'true')
  const busy = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('sessclone_demo_refresh'))`
    return call('the-secret')
  })
  expect(busy.status).toBe(409)
  expect(nextCache.revalidateTag).not.toHaveBeenCalled()

  // A refresh that seeds expires the demo's cached reads at once, not
  // stale-while-revalidate: the next visitor must not get yesterday.
  const seeded = await call('the-secret')
  expect(seeded.status).toBe(200)
  expect(nextCache.revalidateTag).toHaveBeenCalledWith('demo', { expire: 0 })
})

const form = (entries: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(entries)) data.append(key, value)
  return data
}

test('signing in, signing out and leaving all end the demo', async () => {
  const fixture = await seedFixture()
  const actions = await import('../app/sign-in/actions')
  const { exitDemo } = await import('../app/demo/actions')
  const { GET: callback } = await import('../app/auth/callback/route')
  const ends = async (run: () => Promise<unknown>) => {
    enterDemo()
    await run().catch((error: unknown) => {
      if (!String(error).includes('NEXT_REDIRECT')) throw error
    })
    return !jar.has(DEMO_COOKIE)
  }

  expect(await ends(() => actions.signInWithGitHub(form({})))).toBe(true)
  expect(
    await ends(() => actions.sendMagicLink(form({ email: 'not an email' }))),
  ).toBe(true)
  expect(await ends(() => actions.signOut())).toBe(true)
  expect(await ends(() => exitDemo())).toBe(true)

  // The callback answers with the session's cookies, so it clears the demo's
  // on its own response.
  claims = { sub: fixture.acme.users.owner, email: 'owner@acme.test' }
  const response = await callback(
    new NextRequest('https://app.test/auth/callback?code=abc'),
  )
  expect(response.headers.get('location')).toBe('https://app.test/costs')
  expect(response.cookies.get(DEMO_COOKIE)?.value).toBe('')
})

test('the demo visitor is signed out wherever an account is the point', async () => {
  await createDemo()
  enterDemo()
  const { realSessionUser, sessionUser } =
    await import('../lib/supabase/server')
  const { acceptAction } = await import('../app/join/[token]/actions')
  const { default: Join } = await import('../app/join/[token]/page')

  expect(await sessionUser()).toMatchObject({ id: DEMO_USER_ID })
  expect(await realSessionUser()).toBeNull()
  expect(await acceptAction(null, new FormData())).toEqual({
    error: 'Sign in to accept this invitation.',
  })
  const page = await Join({ params: Promise.resolve({ token: 'abc' }) })
  expect(page.props.headline).toBe('Sign in to accept this invitation')

  // A real session whose claims cannot be read is signed out, never the
  // demo visitor, unless the demo cookie is there.
  jar.clear()
  claims = null
  expect(await sessionUser()).toBeNull()
})

test('only the demo visitor’s reads are cached, and they are read as the demo visitor', async () => {
  const fixture = await seedFixture()
  await createDemo()
  const visitor = demoId('member:northwind:0')
  await sql`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at)
    values (${fixture.acme.id}, ${fixture.acme.members.owner}, 'real', 'm',
            ${NIGHT}),
           (${NORTHWIND}, ${visitor}, 'demo', 'm', ${NIGHT})
  `
  const { costsReads, sessionsReads } = await import('../lib/page-reads')
  const range = { from: '2026-09-01', to: '2026-10-01' }
  const costsOf = (orgId: string, memberId: string) => ({
    orgId,
    memberId,
    timezone: 'UTC',
    range,
    time: true,
    dimension: null,
    failures: false,
  })
  const sessionsOf = (orgId: string) => ({
    orgId,
    timezone: 'UTC',
    range,
    filter: {},
    before: undefined,
  })

  // A real Owner: their own rows, live, and nothing tagged for the cache.
  const owner = fixture.acme.users.owner
  const [, [, realDays]] = await costsReads(
    owner,
    costsOf(fixture.acme.id, fixture.acme.members.owner),
    NIGHT,
  )
  const [realSessions] = await sessionsReads(
    owner,
    sessionsOf(fixture.acme.id),
    NIGHT,
  )
  expect(realDays!.rows.length).toBeGreaterThan(0)
  expect(realSessions.sessions.map((row) => row.sessionId)).toEqual(['real'])
  expect(nextCache.cacheTag).not.toHaveBeenCalled()

  // The demo visitor: cached, keyed by the demo day, and read as the demo
  // visitor, so even an entry asked for with a real Org's id holds nothing
  // of it.
  const [, [, demoDays]] = await costsReads(
    DEMO_USER_ID,
    costsOf(NORTHWIND, visitor),
    NIGHT,
  )
  expect(demoDays!.rows.length).toBeGreaterThan(0)
  expect(nextCache.cacheTag).toHaveBeenCalledWith('demo', 'demo:2026-09-25')
  const [leak] = await sessionsReads(
    DEMO_USER_ID,
    sessionsOf(fixture.acme.id),
    NIGHT,
  )
  expect(leak.sessions).toEqual([])
})

test('Exit demo leaves for the landing page, or sign-in where there is none', async () => {
  const { exitDemo } = await import('../app/demo/actions')
  // The redirect's digest is `NEXT_REDIRECT;replace;<path>;307;`.
  const leavesFor = async (path: string) => {
    enterDemo()
    await expect(exitDemo()).rejects.toMatchObject({
      digest: expect.stringContaining(`;${path};`),
    })
    expect(jar.has(DEMO_COOKIE)).toBe(false)
  }

  vi.stubEnv('ENABLE_LANDING', 'true')
  await leavesFor('/')
  // Ticket 138: `/` with no landing page would only bounce to sign-in.
  vi.stubEnv('ENABLE_LANDING', 'false')
  await leavesFor('/sign-in')
})
