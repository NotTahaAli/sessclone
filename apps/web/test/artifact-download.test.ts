import { beforeEach, expect, test, vi } from 'vitest'

import { GET } from '../app/api/logs/download/[id]/route'
import { owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 60: who may download a transcript, proven against the policies
// rather than through the UI.
//
// The signer is stubbed and the session is faked; everything that decides the
// answer — the `log_artifacts_read` policy — is real. What a stubbed signer
// cannot prove is which rows a Role can reach, and that is the whole question
// here.
//
// `asViewer` is redirected to the harness's `asUser`, which opens the same
// claim-setting transaction on the *unprivileged* role. It has to be: this
// suite's `DATABASE_URL` is the role that owns the tables, and Postgres
// applies no policy to an owner — so a policy test on that connection would
// pass while enforcing nothing.

const session = vi.hoisted(() => ({ userId: null as string | null }))
const storage = vi.hoisted(() => ({ configured: true, signs: true }))

vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})

vi.mock('../lib/supabase/server', () => ({
  signedInUser: async () =>
    session.userId === null ? null : { id: session.userId },
}))

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  storageConfigured: () => storage.configured,
  presignDownload: async (key: string, filename: string) => {
    if (!storage.signs) throw new Error('cannot sign')
    return `https://storage.test/${key}?filename=${encodeURIComponent(filename)}&signed`
  },
}))

let fixture: Fixture

const seedArtifact = async ({
  memberId,
  orgId,
  sessionId = 'session-1',
  agentId = null,
}: {
  memberId: string
  orgId: string
  sessionId?: string
  agentId?: string | null
}) => {
  const [row] = await sql<{ id: string }[]>`
    insert into log_artifacts ${sql({
      org_id: orgId,
      member_id: memberId,
      session_id: sessionId,
      agent_id: agentId,
      storage_key: `orgs/${orgId}/members/${memberId}/projects/none/${sessionId}${
        agentId ? `/agents/${agentId}` : ''
      }.jsonl`,
      sha256: 'a'.repeat(64),
      size_bytes: 2048,
    })}
    returning id
  `
  return row!.id
}

const download = (id: string) =>
  GET(new Request(`https://sessclone.test/api/logs/download/${id}`), {
    params: Promise.resolve({ id }),
  })

/** Signs in as one of the fixture's people for the duration of one call. */
const as = async (role: keyof Fixture['acme']['users'], id: string) => {
  session.userId = fixture.acme.users[role]
  return download(id)
}

beforeEach(async () => {
  fixture = await seedFixture()
  session.userId = null
  storage.configured = true
  storage.signs = true
})

test('a Member downloads their own transcript, as a redirect to storage', async () => {
  const id = await seedArtifact({
    memberId: fixture.acme.members.member,
    orgId: fixture.acme.id,
  })

  const answer = await as('member', id)

  expect(answer.status).toBe(302)
  // The bytes never come through the application (ADR 0003).
  expect(answer.headers.get('location')).toContain('https://storage.test/')
  // The URL expires, so nothing may cache the answer that carries it.
  expect(answer.headers.get('cache-control')).toBe('no-store')
})

test('the download is named after the Session, and an Agent Run says which', async () => {
  const own = await seedArtifact({
    memberId: fixture.acme.members.member,
    orgId: fixture.acme.id,
  })
  const run = await seedArtifact({
    memberId: fixture.acme.members.member,
    orgId: fixture.acme.id,
    agentId: 'agent-7',
  })

  expect((await as('member', own)).headers.get('location')).toContain(
    `filename=${encodeURIComponent('session-1.jsonl')}`,
  )
  expect((await as('member', run)).headers.get('location')).toContain(
    `filename=${encodeURIComponent('session-1-agent-agent-7.jsonl')}`,
  )
})

test('a platform admin downloads nothing', async () => {
  const id = await seedArtifact({
    memberId: fixture.acme.members.member,
    orgId: fixture.acme.id,
  })

  // `log_artifacts_read` has no platform-admin branch, unlike `subscriptions_read`
  // and `subscription_events_read` beside it in the same migration. That is
  // ADR 0005: the operator of the deployment is not a party to a Member's
  // transcript. Asserted here so adding one for symmetry fails a test rather
  // than quietly handing the operator every transcript on the deployment.
  session.userId = fixture.platformAdmin.userId
  expect((await download(id)).status).toBe(404)
})

test('a removed Member downloads nothing, their own included', async () => {
  const id = await seedArtifact({
    memberId: fixture.acme.members.removed,
    orgId: fixture.acme.id,
  })

  expect((await as('removed', id)).status).toBe(404)
  // It is still the Org's record, so an Owner may fetch it.
  expect((await as('owner', id)).status).toBe(302)
})

test('another Org’s transcript is a 404, not a 403', async () => {
  const id = await seedArtifact({
    memberId: fixture.globex.members.member,
    orgId: fixture.globex.id,
  })

  // Indistinguishable from an id that does not exist, on purpose: a 403 would
  // confirm that a transcript somebody cannot see is there.
  const refused = await as('owner', id)
  const absent = await as('owner', '00000000-0000-4000-8000-000000000000')
  expect([refused.status, absent.status]).toEqual([404, 404])
  expect(await refused.text()).toBe(await absent.text())
})

test('nobody signed in gets a 401, and a bad id a 404', async () => {
  const id = await seedArtifact({
    memberId: fixture.acme.members.member,
    orgId: fixture.acme.id,
  })

  session.userId = null
  expect((await download(id)).status).toBe(401)

  session.userId = fixture.acme.users.member
  expect((await download('not-a-uuid')).status).toBe(404)
})

test('a deployment that cannot sign says so rather than redirecting nowhere', async () => {
  const id = await seedArtifact({
    memberId: fixture.acme.members.member,
    orgId: fixture.acme.id,
  })

  storage.configured = false
  expect((await as('member', id)).status).toBe(503)

  storage.configured = true
  storage.signs = false
  expect((await as('member', id)).status).toBe(503)
})
