import { beforeEach, expect, test, vi } from 'vitest'

import { listApiKeys } from '../lib/api-keys'
import { viewerAppearance } from '../lib/appearance'
import { storedProjects, storedSessions } from '../lib/artifacts'
import { listOwnDevices } from '../lib/devices'
import { revokeInvitation } from '../lib/invitations'
import { setMemberRemoved, setMemberRole } from '../lib/members'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// The Org switcher: one person, two Orgs. The policies answer "what may this
// person see", which is the union of every Org they are in; the dashboard asks
// "what is in the Org on the screen". A read that leans on the policy alone
// answers the first question on a page that asks the second, so each read
// below is asked for Acme by somebody who is also in Globex, with rows of
// their own in both.

// For the Server Actions: only Supabase's JWT check and the request's cookies
// are stubbed; the viewer read and the writes are the real ones.
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
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})

let fixture: Fixture
/** Acme's Owner, as an Admin of Globex too. */
let person: string
let elsewhere: string

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon')
  jar.clear()
  fixture = await seedFixture()
  claims = { sub: fixture.acme.users.owner, email: 'owner@acme.test' }
  person = fixture.acme.users.owner
  const [row] = await sql<{ id: string }[]>`
    insert into members (org_id, user_id, role)
    values (${fixture.globex.id}, ${person}, 'admin') returning id
  `
  elsewhere = row!.id

  const here = fixture.acme.members.owner
  await sql`
    insert into devices (member_id, key)
    values (${here}, 'acme-laptop'), (${elsewhere}, 'globex-laptop')
  `
  await sql`
    insert into api_keys (member_id, label, key_hash, key_prefix)
    values (${here}, 'acme', ${'1'.repeat(64)}, 'sc_acme'),
           (${elsewhere}, 'globex', ${'2'.repeat(64)}, 'sc_globex')
  `
  await sql`
    insert into log_artifacts (org_id, member_id, session_id, storage_key,
                               sha256, size_bytes)
    values (${fixture.acme.id}, ${here}, 'acme-own', 'a/1', ${'a'.repeat(64)}, 1),
           (${fixture.acme.id}, ${fixture.acme.members.member}, 'acme-team',
            'a/2', ${'a'.repeat(64)}, 1),
           (${fixture.globex.id}, ${elsewhere}, 'globex-own', 'g/1',
            ${'a'.repeat(64)}, 1),
           (${fixture.globex.id}, ${fixture.globex.members.member},
            'globex-team', 'g/2', ${'a'.repeat(64)}, 1)
  `
})

test('every Org-scoped read answers for the current Org alone', async () => {
  const orgId = fixture.acme.id
  const memberId = fixture.acme.members.owner

  const [devices, keys, sessions, own, team] = await asUser(person, (tx) =>
    Promise.all([
      listOwnDevices(tx, memberId),
      listApiKeys(tx, memberId),
      storedSessions(tx, { orgId }),
      storedProjects(tx, { orgId }),
      storedProjects(tx, { orgId, audience: 'team' }),
    ]),
  )

  expect(devices.devices.map((device) => device.key)).toEqual(['acme-laptop'])
  expect(keys.map((key) => key.label)).toEqual(['acme'])
  expect(sessions.sessions.map((session) => session.sessionId)).toEqual([
    'acme-own',
  ])
  expect(own.projects.map((project) => project.memberId)).toEqual([memberId])
  expect(team.projects.map((project) => project.memberId).toSorted()).toEqual(
    [memberId, fixture.acme.members.member].toSorted(),
  )
})

test('the appearance is the current membership’s, not the oldest', async () => {
  await sql`update orgs set accent_locked = true where id = ${fixture.globex.id}`

  const [here, there] = await asUser(person, (tx) =>
    Promise.all([
      viewerAppearance(tx, fixture.acme.members.owner),
      viewerAppearance(tx, elsewhere),
    ]),
  )

  expect(here.locked).toBe(false)
  expect(there.locked).toBe(true)
})

test('an Org settings form naming another of the viewer’s Orgs is refused', async () => {
  // Acme is current (the oldest, with no choice made); the person is an
  // Admin of Globex too, so only the current-Org rule stands in the way.
  const { setRetention } =
    await import('../app/(dashboard)/settings/org/actions')
  const form = new FormData()
  form.append('days', '30')
  form.append('orgId', fixture.globex.id)

  expect(await setRetention(null, form)).toEqual({
    error: 'Sign in again to change retention.',
  })
  const [row] = await sql<{ retention_days: number }[]>`
    select retention_days from orgs where id = ${fixture.globex.id}
  `
  expect(row!.retention_days).toBe(90)
})

test('Members writes touch only the Org they are made in', async () => {
  const [invite] = await sql<{ id: string }[]>`
    insert into invitations (org_id, email, token_hash)
    values (${fixture.globex.id}, 'new@globex.test', ${'c'.repeat(64)})
    returning id
  `
  const target = fixture.globex.members.member

  const written = await asUser(person, (tx) =>
    Promise.all([
      setMemberRole(tx, fixture.acme.id, target, 'manager'),
      setMemberRemoved(tx, fixture.acme.id, target, true),
      revokeInvitation(tx, fixture.acme.id, invite!.id),
    ]),
  )

  expect(written).toEqual([false, false, false])
})

test('the chosen Org is honoured only when it is one of the viewer’s own', async () => {
  const { sessionViewer, MEMBER_COOKIE } = await import('../lib/viewer')
  const current = async (chosen: string | null) => {
    jar.clear()
    if (chosen) jar.set(MEMBER_COOKIE, chosen)
    return (await sessionViewer())?.orgId
  }

  // No choice: today's order, the oldest.
  expect(await current(null)).toBe(fixture.acme.id)
  expect(await current(elsewhere)).toBe(fixture.globex.id)
  // Somebody else's membership, garbage, and a removed one of their own all
  // fall back rather than fail.
  expect(await current(fixture.globex.members.owner)).toBe(fixture.acme.id)
  expect(await current('not-a-uuid')).toBe(fixture.acme.id)
  await asUser(fixture.globex.users.owner, (tx) =>
    setMemberRemoved(tx, fixture.globex.id, elsewhere, true),
  )
  expect(await current(elsewhere)).toBe(fixture.acme.id)
})

test('switching refuses a membership that is not the viewer’s', async () => {
  const { switchOrg } = await import('../app/(dashboard)/org-actions')
  const { MEMBER_COOKIE } = await import('../lib/viewer')
  const form = new FormData()
  form.append('memberId', fixture.globex.members.owner)

  expect(await switchOrg(null, form)).toEqual({
    error: 'That is not one of your Orgs.',
  })
  expect(jar.has(MEMBER_COOKIE)).toBe(false)

  form.set('memberId', elsewhere)
  await expect(switchOrg(null, form)).rejects.toThrow(/NEXT_REDIRECT/)
  expect(jar.get(MEMBER_COOKIE)).toBe(elsewhere)
})

test('a tab left open across a switch cannot invite or issue a key in the new Org', async () => {
  // The page was rendered for Globex; the cookie has since moved to Acme
  // (here: no choice, so the oldest). The forms carry the Org they were
  // drawn for, and a mismatch is refused before anything is written.
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://127.0.0.1:3000')
  const { sendInvite } =
    await import('../app/(dashboard)/settings/org/members/invite-actions')
  const { createKey } = await import('../app/(dashboard)/keys/actions')

  const invitation = new FormData()
  invitation.append('email', 'new@example.test')
  invitation.append('role', 'member')
  invitation.append('orgId', fixture.globex.id)
  expect(await sendInvite(null, invitation)).toMatchObject({
    error: expect.any(String),
  })

  const key = new FormData()
  key.append('label', 'laptop')
  key.append('orgId', fixture.globex.id)
  expect(await createKey(null, key)).toMatchObject({
    error: expect.any(String),
  })

  expect(await sql`select id from invitations`).toHaveLength(0)
  expect(
    await sql`select id from api_keys where label = 'laptop'`,
  ).toHaveLength(0)
})
