import type { ReportedTurn } from '@sessclone/shared'
import { beforeEach, expect, test, vi } from 'vitest'

import { POST } from '../app/api/ingest/route'
import { owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 31 establishes the route suite for ingest, against a real Postgres
// with the real migrations (AGENTS.md: routes and policies are tested there,
// never against a fake). Later tickets extend this file rather than starting
// their own: 33 (the real Collector payload), 34 (key verification and the
// rejection cases), 35 (Agent Runs), 37 (cursor), 38 and 40 (session events).

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const usage = {
  inputTokens: 12,
  outputTokens: 202,
  cacheReadInputTokens: 53856,
  cacheCreationInputTokens: 900,
  cacheCreation5mInputTokens: 900,
  cacheCreation1hInputTokens: 0,
  thinkingTokens: 64,
  webSearchRequests: 1,
  webFetchRequests: 0,
}

const turn = (over: Partial<ReportedTurn> = {}): ReportedTurn => ({
  sessionId: 'session-1',
  agentId: null,
  messageId: 'msg_01',
  model: 'claude-opus-4-6',
  serviceTier: 'standard',
  speed: null,
  inferenceGeo: null,
  clientVersion: '2.1.0',
  timestamp: '2026-09-20T08:28:20.655Z',
  cwd: '/home/dev/api',
  gitBranch: 'main',
  requestId: 'req_01',
  complete: true,
  usage,
  entryUuids: ['a1', 'a2'],
  ...over,
})

const report = (over: Record<string, unknown> = {}) => ({
  sessionId: 'session-1',
  agentId: null,
  project: {
    key: 'github.com/acme/api',
    remote: 'git@github.com:acme/api.git',
  },
  cursor: { messageId: 'msg_01', byteOffset: 4096 },
  turns: [turn()],
  ...over,
})

const payload = (memberId: string, over: Record<string, unknown> = {}) => ({
  memberId,
  device: { key: 'host:build-box' },
  reports: [report()],
  ...over,
})

const post = (body: unknown, handler: typeof POST = POST) =>
  handler(
    new Request('http://localhost/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

test('stores a reported turn with the counters it carried', async () => {
  const response = await post(payload(fixture.acme.members.member))

  expect(response.status).toBe(200)

  const rows = await sql`
    select org_id, member_id, session_id, agent_id, message_id, occurred_at,
           input_tokens, output_tokens, cache_read_input_tokens,
           thinking_tokens, web_search_requests, model, client_version, complete
      from turns
  `

  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    org_id: fixture.acme.id,
    member_id: fixture.acme.members.member,
    session_id: 'session-1',
    agent_id: null,
    message_id: 'msg_01',
    input_tokens: 12,
    output_tokens: 202,
    cache_read_input_tokens: 53856,
    thinking_tokens: 64,
    web_search_requests: 1,
    model: 'claude-opus-4-6',
    client_version: '2.1.0',
    complete: true,
  })
  expect(rows[0]!.occurred_at).toEqual(new Date('2026-09-20T08:28:20.655Z'))
})

test('the same payload twice leaves one row each', async () => {
  const body = payload(fixture.acme.members.member)

  await post(body)
  const second = await post(body)

  expect(second.status).toBe(200)
  expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 1 }])
  expect(await sql`select count(*)::int as n from devices`).toEqual([{ n: 1 }])
  expect(await sql`select count(*)::int as n from projects`).toEqual([{ n: 1 }])
})

test('a device and a project are created once and then reused', async () => {
  await post(payload(fixture.acme.members.member))

  const [first] = await sql<{ id: string; last_seen_at: Date }[]>`
    select id, last_seen_at from devices
  `
  const [project] = await sql<{ id: string }[]>`select id from projects`

  // A second report from the same machine, a later turn in the same Session.
  await post(
    payload(fixture.acme.members.member, {
      reports: [report({ turns: [turn({ messageId: 'msg_02' })] })],
    }),
  )

  const devices = await sql<{ id: string; last_seen_at: Date }[]>`
    select id, last_seen_at from devices
  `
  expect(devices).toHaveLength(1)
  expect(devices[0]!.id).toBe(first!.id)
  expect(devices[0]!.last_seen_at.getTime()).toBeGreaterThanOrEqual(
    first!.last_seen_at.getTime(),
  )

  expect(await sql`select id from projects`).toEqual([{ id: project!.id }])
  expect(
    await sql`select device_id, project_id from turns where message_id = 'msg_02'`,
  ).toEqual([{ device_id: first!.id, project_id: project!.id }])
})

test('the response carries the cursor position for each transcript', async () => {
  const response = await post(
    payload(fixture.acme.members.member, {
      reports: [
        report(),
        report({
          sessionId: 'session-2',
          agentId: 'agent-9',
          cursor: { messageId: 'msg_07', byteOffset: 900 },
          turns: [
            turn({
              sessionId: 'session-2',
              agentId: 'agent-9',
              messageId: 'msg_07',
            }),
          ],
        }),
      ],
    }),
  )

  expect(await response.json()).toEqual({
    accepted: [
      {
        sessionId: 'session-1',
        agentId: null,
        turns: 1,
        cursor: { messageId: 'msg_01', byteOffset: 4096 },
      },
      {
        sessionId: 'session-2',
        agentId: 'agent-9',
        turns: 1,
        cursor: { messageId: 'msg_07', byteOffset: 900 },
      },
    ],
  })

  expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 2 }])
})

test('a malformed payload is refused and writes nothing', async () => {
  const response = await post({
    memberId: fixture.acme.members.member,
    device: { key: 'host:build-box' },
    reports: [report({ turns: [{ ...turn(), messageId: '' }] })],
  })

  expect(response.status).toBe(400)
  expect(await sql`select 1 from turns`).toEqual([])
  expect(await sql`select 1 from devices`).toEqual([])
  expect(await sql`select 1 from projects`).toEqual([])
})

test('a body that is not a payload at all is refused', async () => {
  const response = await post({ nonsense: true })

  expect(response.status).toBe(400)
  expect(await sql`select 1 from turns`).toEqual([])
})

test('a member nobody knows is refused and writes nothing', async () => {
  const response = await post(payload('00000000-0000-4000-8000-00000000dead'))

  expect(response.status).toBe(400)
  expect(await sql`select 1 from turns`).toEqual([])
  expect(await sql`select 1 from devices`).toEqual([])
})

test('a turn cannot be filed across the Org boundary', async () => {
  // Both Members report the same Project key from a machine with the same
  // Device key. The Org comes from the Member, never from the payload, so
  // neither row may be reused across the boundary.
  await post(payload(fixture.acme.members.member))
  await post(payload(fixture.globex.members.member))

  expect(
    await sql`select org_id, key from projects order by org_id`,
  ).toHaveLength(2)

  const rows = await sql<{ org_id: string; member_id: string }[]>`
    select t.org_id, t.member_id from turns t join projects p on p.id = t.project_id
     where p.org_id = t.org_id
  `
  expect(rows).toHaveLength(2)

  const globex = await sql`
    select org_id from turns where member_id = ${fixture.globex.members.member}
  `
  expect(globex).toEqual([{ org_id: fixture.globex.id }])

  // Two Members, two machines: the Device key is unique per Member by schema.
  expect(await sql`select count(*)::int as n from devices`).toEqual([{ n: 2 }])
})

test('ingest reads its own connection variable and never falls back', async () => {
  // A correct deployment points DATABASE_URL at `sessclone_app`, which has no
  // insert grant on `turns`. A fallback here would write as the dashboard's
  // role in tests and as nothing at all in production, so there is none: the
  // route says what is missing instead.
  const before = process.env.INGEST_DATABASE_URL
  delete process.env.INGEST_DATABASE_URL
  vi.resetModules()
  try {
    const fresh = await import('../app/api/ingest/route')
    await expect(
      post(payload(fixture.acme.members.member), fresh.POST),
    ).rejects.toThrow('INGEST_DATABASE_URL is not set')
  } finally {
    process.env.INGEST_DATABASE_URL = before
    vi.resetModules()
  }
})

test('a batch the database refuses leaves the database exactly as it was', async () => {
  // Past zod (a counter has no upper bound on the wire) and into `integer out
  // of range`, after the Device and the Project rows would have been written.
  const response = await post(
    payload(fixture.acme.members.member, {
      reports: [
        report({
          turns: [turn({ usage: { ...usage, inputTokens: 2 ** 31 } })],
        }),
      ],
    }),
  )

  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: expect.any(String) })
  expect(await sql`select 1 from turns`).toEqual([])
  expect(await sql`select 1 from devices`).toEqual([])
  expect(await sql`select 1 from projects`).toEqual([])
})

test('a batch larger than one insert chunk lands every row', async () => {
  // Past Postgres's 65534 bind parameters at 23 columns a row (2849 rows),
  // which is what one statement per batch could never send.
  const turns = Array.from({ length: 3000 }, (_, index) =>
    turn({ messageId: `msg_${index}` }),
  )

  const response = await post(
    payload(fixture.acme.members.member, { reports: [report({ turns })] }),
  )

  expect(response.status).toBe(200)
  expect(await sql`select count(*)::int as n from turns`).toEqual([
    { n: turns.length },
  ])
})
