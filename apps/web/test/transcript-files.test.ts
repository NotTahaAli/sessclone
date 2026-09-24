import { beforeEach, expect, test, vi } from 'vitest'

import { GET as files } from '../app/api/transcripts/[sessionId]/route'
import { GET as costs } from '../app/api/transcripts/[sessionId]/costs/route'
import { owner as sql, seedFixture, type Fixture } from './harness'

// Tickets 105-107: the viewer's two reads, against the real policies on the
// unprivileged role. Only the session and the signer are faked.

const session = vi.hoisted(() => ({ userId: null as string | null }))

vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})
vi.mock('../lib/supabase/server', () => {
  const who = async () =>
    session.userId === null ? null : { id: session.userId }
  return { signedInUser: who, sessionUser: who }
})
vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  storageConfigured: () => true,
  presignDownload: async (key: string, _name: string, type?: string) =>
    `https://storage.test/${key}?signed${type ? `&type=${type}` : ''}`,
}))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  session.userId = null
})

const artifact = async (
  agentId: string | null,
  kind = 'transcript',
  memberId = fixture.acme.members.member,
) => {
  const { id: orgId } = fixture.acme
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

/** ADR 0008: seals `count` 1 KiB chunks before the row's tail, out of order. */
const seal = async (count: number) => {
  const [row] = await sql<{ id: string; member_id: string }[]>`
    update log_artifacts
       set sealed_bytes = ${count * 1024}, sealed_sha256 = ${'c'.repeat(64)},
           storage_key = storage_key || ${`/tail-${count}.jsonl`}
     where agent_id is null and kind = 'transcript'
    returning id, member_id
  `
  const seqs = Array.from({ length: count }, (_, i) => count - i)
  await sql`
    insert into log_artifact_chunks ${sql(
      seqs.map((seq) => ({
        artifact_id: row!.id,
        member_id: row!.member_id,
        seq,
        raw_offset: (seq - 1) * 1024,
        raw_length: 1024,
        stored_bytes: 300,
        sha256: String(seq).repeat(64).slice(0, 64),
        storage_key: `chunks/${seq}.jsonl.gz`,
      })),
    )}
  `
}

const call = (
  route: typeof files,
  sessionId: string,
  userId: string | null,
  member: string | null = fixture.acme.members.member,
) => {
  session.userId = userId
  const query = member === null ? '' : `?member=${member}`
  return route(new Request(`https://sessclone.test/${query}`), {
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

test('two Members with the same session id: each viewer reads only its own Member', async () => {
  // Session ids are unique per Member, not per deployment.
  const { member, owner } = fixture.acme.members
  await artifact(null, 'transcript', member)
  await artifact(null, 'transcript', owner)
  const turn = (memberId: string, messageId: string) => ({
    org_id: fixture.acme.id,
    member_id: memberId,
    session_id: 's-1',
    message_id: messageId,
    occurred_at: '2026-09-01T00:00:00Z',
    input_tokens: 1,
  })
  await sql`insert into turns ${sql([turn(member, 'm-a'), turn(owner, 'm-b')])}`

  const listed = await (
    await call(files, 's-1', fixture.acme.users.owner, member)
  ).json()
  expect(listed.files).toHaveLength(1)
  expect(listed.files[0].url).toContain(`/members/${member}/`)

  const priced = await (
    await call(costs, 's-1', fixture.acme.users.owner, member)
  ).json()
  expect(Object.keys(priced)).toEqual([':m-a'])

  // The member is required, and must be a uuid.
  expect(
    (await call(files, 's-1', fixture.acme.users.owner, null)).status,
  ).toBe(404)
  expect((await call(costs, 's-1', fixture.acme.users.owner, 'x')).status).toBe(
    404,
  )
})

test('a chunked transcript lists its chunks in seq order; a whole file has none', async () => {
  // Ticket 132.
  await artifact(null)
  await artifact('agent-1')
  await seal(3)

  const body = await (await call(files, 's-1', fixture.acme.users.owner)).json()
  const [main, agent] = body.files
  expect(main.tailOffset).toBe(3072)
  expect(main.sizeBytes).toBe(100)
  expect(main.chunks).toEqual(
    [1, 2, 3].map((seq) => ({
      rawOffset: (seq - 1) * 1024,
      rawLength: 1024,
      sha256: String(seq).repeat(64),
      url: `https://storage.test/chunks/${seq}.jsonl.gz?signed&type=application/gzip`,
    })),
  )
  expect(agent).toMatchObject({ tailOffset: 0, chunks: [] })

  // A Member sees their own, and nobody outside the Org sees either.
  const own = await (await call(files, 's-1', fixture.acme.users.member)).json()
  expect(own.files[0].chunks).toHaveLength(3)
  expect((await call(files, 's-1', fixture.globex.users.owner)).status).toBe(
    404,
  )
})
