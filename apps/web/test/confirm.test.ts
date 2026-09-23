import { beforeEach, expect, test, vi } from 'vitest'

import { POST } from '../app/api/logs/confirm/route'
import { generateApiKey } from '../lib/api-keys'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 59: the request that records an upload, against a real Postgres with
// the real migrations.
//
// Storage is stubbed and nothing else is. What this file is about is the row —
// whether it is written at all, what it says, and that it says the size the
// deployment read back rather than the one a Collector claimed.

const stored = vi.hoisted(() => ({
  size: 4096 as number | null,
  /** Set to throw from `storedObject`, as an unreachable provider does. */
  unreadable: false,
  configured: true,
  /** Keys `deleteObjects` was asked to remove, newest call last. */
  deleted: [] as string[][],
}))

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  storageConfigured: () => stored.configured,
  storedObject: async () => {
    if (stored.unreadable) throw new Error('endpoint refused')
    return stored.size === null ? null : { sizeBytes: stored.size }
  },
  deleteObjects: async (keys: string[]) => {
    stored.deleted.push(keys)
  },
}))

let fixture: Fixture
let key: string

const SHA = 'a'.repeat(64)

const issueKey = async (memberId: string) => {
  const { key: plaintext, prefix, hash } = generateApiKey()
  await sql`
    insert into api_keys (member_id, label, key_hash, key_prefix)
    values (${memberId}, 'laptop', ${hash}, ${prefix})
  `
  return plaintext
}

const withArchival = async (orgId: string, available = true) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, archival_available, sort_order)
    values (${`tier-${orgId.slice(0, 8)}-${available}`}, 'Team', 10,
            ${available}, 1)
    on conflict (key) do update set archival_available = excluded.archival_available
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${orgId}, ${tier!.id}, 'active')
    on conflict (org_id) do update set tier_id = excluded.tier_id
  `
}

/** A Project, and a Turn placing the Session in it: the only thing that tells
 * this route where a Session belongs. */
const seedSession = async ({
  memberId = '',
  sessionId = 'session-1',
  agentId = null,
  projectKey = 'github.com/acme/api',
}: {
  memberId?: string
  sessionId?: string
  agentId?: string | null
  projectKey?: string | null
} = {}) => {
  const member = memberId || fixture.acme.members.member
  let projectId: string | null = null
  if (projectKey !== null) {
    const [project] = await sql<{ id: string }[]>`
      insert into projects (org_id, key) values (${fixture.acme.id}, ${projectKey})
      on conflict (org_id, key) do update set key = excluded.key
      returning id
    `
    projectId = project!.id
  }

  await sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: member,
      project_id: projectId,
      session_id: sessionId,
      agent_id: agentId,
      message_id: `msg_${sessionId}_${agentId ?? 'main'}_${projectKey ?? 'none'}`,
      occurred_at: new Date(),
      model: 'claude-opus-4-6',
      input_tokens: 10,
    })}
  `
  return projectId
}

const setArchival = (enabled: boolean) =>
  asUser(
    fixture.acme.users.member,
    (tx) =>
      tx`update members set archival_enabled = ${enabled}
          where id = ${fixture.acme.members.member}`,
  )

const ask = async (
  body: Record<string, unknown> = {},
  presented: string | null = key,
) =>
  POST(
    new Request('https://sessclone.test/api/logs/confirm', {
      method: 'POST',
      headers: presented
        ? {
            authorization: `Bearer ${presented}`,
            'content-type': 'application/json',
          }
        : { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-1',
        sha256: SHA,
        // The key the presign issued, which the Collector echoes. Overridden
        // by the tests that are about it.
        storageKey: derivedKey(),
        ...body,
      }),
    }),
  )

const answer = async (response: Response) =>
  [response.status, await response.json()] as const

/**
 * The object key this Member's `session-1` resolves to for a Project.
 *
 * The Project segment is flattened rather than percent-encoded, because
 * storage refuses a key carrying `%` (ADR 0003). Written out here rather than
 * imported, so a change to how keys are built fails this file instead of
 * agreeing with itself; the fixtures' keys only carry slashes.
 */
const derivedKey = (
  projectKey: string | null = 'github.com/acme/api',
  agentId: string | null = null,
) =>
  `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/${
    projectKey === null ? 'none' : projectKey.replaceAll('/', '-')
  }/${agentId ? `session-1/agents/${agentId}.jsonl` : 'session-1.jsonl'}`

type ArtifactRow = {
  project_id: string | null
  session_id: string
  agent_id: string | null
  storage_key: string
  sha256: string
  size_bytes: string
  uploaded_at: Date
}

const artifacts = () => sql<ArtifactRow[]>`
  select project_id, session_id, agent_id, storage_key, sha256, size_bytes,
         uploaded_at
    from log_artifacts order by storage_key
`

beforeEach(async () => {
  fixture = await seedFixture()
  key = await issueKey(fixture.acme.members.member)
  stored.size = 4096
  stored.unreadable = false
  stored.configured = true
  stored.deleted = []
  await setArchival(true)
})

test('a confirmed upload is one row, sized from storage', async () => {
  await withArchival(fixture.acme.id)
  const projectId = await seedSession()

  const [status, body] = await answer(await ask())

  expect(status).toBe(200)
  expect(body).toMatchObject({ stored: true, sizeBytes: 4096 })

  const rows = await artifacts()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    project_id: projectId,
    session_id: 'session-1',
    agent_id: null,
    sha256: SHA,
    // From the provider's own count, never from the request — a truncated
    // upload cannot overstate itself.
    size_bytes: '4096',
  })
  expect(rows[0]!.storage_key).toBe(body.storageKey)
})

test('the Session’s object key is derived, never taken from the Collector', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const [, body] = await answer(
    // A Collector cannot say where its transcript belongs, nor how big it is.
    // The key it echoes is compared against the derived one and never used in
    // its place, and the Project and the size are not fields of this request
    // at all — a body carrying them is ignored rather than honoured.
    await ask({ projectKey: 'x', sizeBytes: 999_999 }),
  )

  expect(body.storageKey).toBe(
    `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/github.com-acme-api/session-1.jsonl`,
  )
  expect(body.sizeBytes).toBe(4096)

  const rows = await artifacts()
  expect(rows[0]).toMatchObject({ size_bytes: '4096' })
  expect(rows[0]!.storage_key).toBe(body.storageKey)
})

test('a Session that grows replaces its row rather than adding one', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  await ask()
  const [first] = await artifacts()

  stored.size = 8192
  const grown = 'b'.repeat(64)
  const [, body] = await answer(await ask({ sha256: grown }))

  expect(body).toMatchObject({ stored: true, sizeBytes: 8192 })
  const rows = await artifacts()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ sha256: grown, size_bytes: '8192' })
  expect(rows[0]!.storage_key).toBe(first!.storage_key)
  expect(rows[0]!.uploaded_at.getTime()).toBeGreaterThanOrEqual(
    first!.uploaded_at.getTime(),
  )
})

test('an Agent Run is its own row beside the Session’s', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedSession({ agentId: 'agent-7' })

  await ask()
  await ask({
    agentId: 'agent-7',
    storageKey: derivedKey(undefined, 'agent-7'),
  })

  const rows = await artifacts()
  expect(
    rows
      .map((row) => row.agent_id)
      .toSorted((a, b) => String(a).localeCompare(String(b))),
  ).toEqual(['agent-7', null])
})

test('confirming the same bytes twice is idempotent, not a second row', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const [, first] = await answer(await ask())
  // The queue drained after the answer was lost, or a retry: the row already
  // records exactly these bytes, which is a success rather than a refusal.
  const [status, again] = await answer(await ask())

  expect(status).toBe(200)
  expect(again).toMatchObject({ stored: true, storageKey: first.storageKey })
  expect(await artifacts()).toHaveLength(1)
})

test('nothing is recorded when the object is not in the bucket', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  stored.size = null

  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'not_uploaded' },
  ])
  expect(await artifacts()).toHaveLength(0)
})

test('every presign refusal refuses here too, and writes nothing', async () => {
  await withArchival(fixture.acme.id)
  const projectId = await seedSession()

  await setArchival(false)
  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'archival_off' },
  ])

  await setArchival(true)
  await sql`
    insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, ${projectId}, false)
  `
  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'project_excluded' },
  ])
  await sql`delete from member_project_archival`

  await sql`delete from subscriptions where org_id = ${fixture.acme.id}`
  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'tier_excludes_archival' },
  ])

  await withArchival(fixture.acme.id)
  expect(await answer(await ask({ sessionId: 'never-seen' }))).toMatchObject([
    200,
    { refused: 'no_turns' },
  ])

  expect(await artifacts()).toHaveLength(0)
})

test('no key, an unknown key and a revoked key are one answer', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const { key: unknown } = generateApiKey()
  const revoked = await issueKey(fixture.acme.members.member)
  await sql`update api_keys set revoked_at = now() where key_prefix = ${revoked.slice(0, 12)}`

  for (const presented of [null, 'sk_nonsense', unknown, revoked]) {
    // eslint-disable-next-line no-await-in-loop -- one at a time, so a failure names which
    const [status, body] = await answer(await ask({}, presented))
    expect(status).toBe(401)
    expect(body.error).toBe('no live API key was presented')
  }
  expect(await artifacts()).toHaveLength(0)
})

test('somebody else’s Session is not this Member’s to record', async () => {
  await withArchival(fixture.acme.id)
  // The Session belongs to the Owner; the key belongs to the Member.
  await seedSession({ memberId: fixture.acme.members.owner })

  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'no_turns' },
  ])
  expect(await artifacts()).toHaveLength(0)
})

test('a malformed body is a 400 naming the field', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const [status, body] = await answer(await ask({ sha256: 'not-a-hash' }))
  expect(status).toBe(400)
  expect(body.error).toBe('not a confirm request')
  expect(body.detail).toContain('sha256')
})

test('a Session that moved Project since the presign is refused, not recorded', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  // The bytes went to the key the presign issued; a Turn under another Project
  // has landed since, so this Session now belongs under a different key. A row
  // written here would name one object and carry another's hash and size, and
  // the unchanged guard would keep it forever.
  const [status, body] = await answer(
    await ask({ storageKey: derivedKey('github.com/acme/other') }),
  )

  expect(status).toBe(200)
  expect(body).toMatchObject({ refused: 'stale_key' })
  expect(await artifacts()).toHaveLength(0)
})

test('a Project change moves the row and destroys the object left behind', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await ask()
  const [first] = await artifacts()

  // A later Turn puts the Session in another Project (ADR 0003's mid-run
  // change), so the next upload goes to a new key.
  await seedSession({ projectKey: 'github.com/acme/other' })
  const moved = derivedKey('github.com/acme/other')
  const [, body] = await answer(
    await ask({ sha256: 'c'.repeat(64), storageKey: moved }),
  )

  expect(body).toMatchObject({ stored: true, storageKey: moved })

  const rows = await artifacts()
  expect(rows).toHaveLength(1)
  expect(rows[0]!.storage_key).toBe(moved)
  // The old object had no row naming it any more, and bytes no retention
  // sweep can reach are a transcript kept forever.
  expect(stored.deleted).toEqual([[first!.storage_key]])
})

test('an upload to the same key deletes nothing', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  await ask()
  await ask({ sha256: 'd'.repeat(64) })

  expect(stored.deleted).toEqual([])
  expect(await artifacts()).toHaveLength(1)
})

test('a deployment that cannot read the object back records nothing', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  stored.unreadable = true

  const [status, body] = await answer(await ask())
  expect(status).toBe(503)
  expect(body.error).toContain('cannot read the uploaded object')
  expect(await artifacts()).toHaveLength(0)
})

test('a deployment with no storage says so rather than half-working', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  stored.configured = false

  const [status, body] = await answer(await ask())
  expect(status).toBe(503)
  expect(body.error).toContain('no storage configured')
  expect(await artifacts()).toHaveLength(0)
})

test('two confirms racing on one Session leave one row', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const [one, two] = await Promise.all([ask(), ask()])

  expect([one.status, two.status]).toEqual([200, 200])
  expect(await artifacts()).toHaveLength(1)
})

test('a run’s sidecar and a workflow’s journal are rows of their own kind beside the transcripts', async () => {
  // Ticket 101. Same member, Session and id as the Agent Run's transcript, so
  // only `kind` keeps the three from being one row; and the journal's id is a
  // workflow run id no Turn carries, so it is filed under the Session's
  // Project rather than refused as never ingested.
  await withArchival(fixture.acme.id)
  const projectId = await seedSession()
  await seedSession({ agentId: 'agent-7' })

  const base = `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/github.com-acme-api/session-1`
  await ask({ agentId: 'agent-7', storageKey: `${base}/agents/agent-7.jsonl` })
  const [metaStatus, meta] = await answer(
    await ask({
      agentId: 'agent-7',
      kind: 'agent_meta',
      storageKey: `${base}/agents/agent-7.meta.json`,
    }),
  )
  const [journalStatus, journal] = await answer(
    await ask({
      agentId: 'wf_01',
      kind: 'workflow_journal',
      storageKey: `${base}/workflows/wf_01.journal.jsonl`,
    }),
  )

  expect([metaStatus, journalStatus]).toEqual([200, 200])
  expect(meta).toMatchObject({ stored: true })
  expect(journal).toMatchObject({ stored: true })

  const rows = await sql<
    { kind: string; agent_id: string; project_id: string }[]
  >`
    select kind, agent_id, project_id from log_artifacts order by kind
  `
  expect(rows).toEqual([
    { kind: 'agent_meta', agent_id: 'agent-7', project_id: projectId },
    { kind: 'transcript', agent_id: 'agent-7', project_id: projectId },
    { kind: 'workflow_journal', agent_id: 'wf_01', project_id: projectId },
  ])

  // The hash guard is per kind: the transcript's stored hash does not make
  // its sidecar `unchanged`, and the sidecar's own does.
  const [, again] = await answer(
    await ask({
      agentId: 'agent-7',
      kind: 'agent_meta',
      storageKey: `${base}/agents/agent-7.meta.json`,
    }),
  )
  expect(again).toMatchObject({
    stored: true,
    storageKey: `${base}/agents/agent-7.meta.json`,
  })
  expect(await artifacts()).toHaveLength(3)
})
