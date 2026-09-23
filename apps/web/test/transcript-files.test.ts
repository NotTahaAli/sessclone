import { beforeEach, expect, test, vi } from 'vitest'

import { GET as files } from '../app/api/transcripts/[sessionId]/route'
import { GET as costs } from '../app/api/transcripts/[sessionId]/costs/route'
import { owner as sql, seedFixture, type Fixture } from './harness'

// Tickets 102-104: the viewer's two reads, against the real policies on the
// unprivileged role. Only the session and the signer are faked.

const session = vi.hoisted(() => ({ userId: null as string | null }))

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
  storageConfigured: () => true,
  presignDownload: async (key: string) => `https://storage.test/${key}?signed`,
}))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  session.userId = null
})

const artifact = async (agentId: string | null, kind = 'transcript') => {
  const { id: orgId } = fixture.acme
  const memberId = fixture.acme.members.member
  await sql`
    insert into log_artifacts ${sql({
      org_id: orgId,
      member_id: memberId,
      session_id: 's-1',
      agent_id: agentId,
      kind,
      storage_key: `orgs/${orgId}/members/${memberId}/projects/none/s-1${
        agentId ? `/agents/${agentId}.${kind}` : ''
      }.jsonl`,
      sha256: 'a'.repeat(64),
      size_bytes: 100,
    })}
  `
}

const call = (
  route: typeof files,
  sessionId: string,
  userId: string | null,
) => {
  session.userId = userId
  return route(new Request('https://sessclone.test/'), {
    params: Promise.resolve({ sessionId }),
  })
}

test('lists every visible file with a presigned URL, main first', async () => {
  await artifact('agent-1')
  await artifact(null)
  await artifact('agent-1', 'agent_meta')

  const answer = await call(files, 's-1', fixture.acme.users.owner)
  expect(answer.status).toBe(200)
  expect(answer.headers.get('cache-control')).toBe('no-store')
  const body = await answer.json()
  expect(body.sessionId).toBe('s-1')
  expect(
    body.files.map((f: { agentId: string | null; kind: string }) => [
      f.agentId,
      f.kind,
    ]),
  ).toEqual([
    [null, 'transcript'],
    ['agent-1', 'agent_meta'],
    ['agent-1', 'transcript'],
  ])
  expect(body.files[0]).toMatchObject({
    sizeBytes: 100,
    url: expect.stringContaining('https://storage.test/'),
    expiresIn: expect.any(Number),
  })
})

test('a viewer outside the Org gets the same 404 as a missing Session', async () => {
  await artifact(null)
  const outside = await call(files, 's-1', fixture.globex.users.owner)
  const missing = await call(files, 'nope', fixture.acme.users.owner)
  expect([outside.status, missing.status]).toEqual([404, 404])
  expect(await outside.text()).toBe(await missing.text())
  expect((await call(files, 's-1', null)).status).toBe(401)
})

test('costs key by agent and message, and unpriced is null not zero', async () => {
  await sql`
    insert into rates (model, class, price_usd, effective_from, source)
    values ('claude-viewer-test', 'input', 2, date '2026-01-01', 'test')
  `
  const turn = (agentId: string | null, messageId: string, model: string) => ({
    org_id: fixture.acme.id,
    member_id: fixture.acme.members.member,
    session_id: 's-1',
    agent_id: agentId,
    message_id: messageId,
    occurred_at: '2026-09-01T00:00:00Z',
    input_tokens: 1_000_000,
    model,
  })
  await sql`insert into turns ${sql([
    turn(null, 'm-1', 'claude-viewer-test'),
    turn('agent-1', 'm-1', 'claude-unknown-model'),
  ])}`

  const answer = await call(costs, 's-1', fixture.acme.users.member)
  expect(await answer.json()).toEqual({
    ':m-1': {
      costUsd: 2,
      model: 'claude-viewer-test',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    'agent-1:m-1': expect.objectContaining({ costUsd: null }),
  })

  const outside = await call(costs, 's-1', fixture.globex.users.owner)
  expect(await outside.json()).toEqual({})
})
