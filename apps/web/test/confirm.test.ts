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
  /** Per-key sizes, for the chunked tests; any other key answers `size`. */
  sizes: {} as Record<string, number | null>,
  /** Set to throw from `storedObject`, as an unreachable provider does. */
  unreadable: false,
  configured: true,
  /** Keys `deleteObjects` was asked to remove, newest call last. */
  deleted: [] as string[][],
}))

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  storageConfigured: () => stored.configured,
  storedObject: async (key: string) => {
    if (stored.unreadable) throw new Error('endpoint refused')
    const size = key in stored.sizes ? stored.sizes[key]! : stored.size
    return size === null ? null : { sizeBytes: size }
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

/**
 * Whether `ask` first records the keys it names as pending, as the presign
 * that issued them would have. The tests about an unpresigned key clear it.
 */
let presigned = true

/** The keys a confirm body names: its tail, and each chunk's content key. */
const keysOf = (body: {
  storageKey: string
  chunks?: { seq: number; sha256: string }[]
}) => {
  const dir = body.storageKey.replace(/\/tail-[^/]*$/, '')
  return [
    body.storageKey,
    ...(body.chunks ?? []).map(
      (chunk) =>
        `${dir}/chunks/${String(chunk.seq).padStart(6, '0')}-${chunk.sha256.slice(0, 16)}.jsonl.gz`,
    ),
  ]
}

const ask = async (
  body: Record<string, unknown> = {},
  presented: string | null = key,
) => {
  const sent = {
    sessionId: 'session-1',
    sha256: SHA,
    // The key the presign issued, which the Collector echoes. Overridden
    // by the tests that are about it.
    storageKey: derivedKey(),
    ...body,
  }
  if (presigned && typeof sent.storageKey === 'string') {
    await sql`
      insert into log_upload_pending ${sql(
        keysOf(sent as Parameters<typeof keysOf>[0]).map((storage_key) => ({
          storage_key,
          member_id: fixture.acme.members.member,
          session_id: 'session-1',
          kind: 'transcript',
          expires_at: new Date(Date.now() + 3_600_000),
        })),
      )}
      on conflict (storage_key) do nothing
    `
  }
  return POST(
    new Request('https://sessclone.test/api/logs/confirm', {
      method: 'POST',
      headers: presented
        ? {
            authorization: `Bearer ${presented}`,
            'content-type': 'application/json',
          }
        : { 'content-type': 'application/json' },
      body: JSON.stringify(sent),
    }),
  )
}

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
  stored.sizes = {}
  stored.unreadable = false
  stored.configured = true
  stored.deleted = []
  presigned = true
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
  // sweep can reach are a transcript kept forever. Queued for the sweep in
  // the confirm's transaction, never deleted by the confirm itself.
  expect(await orphanKeys()).toEqual([first!.storage_key])
  expect(stored.deleted).toEqual([])
})

test('an upload to the same key deletes nothing', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  await ask()
  await ask({ sha256: 'd'.repeat(64) })

  expect(stored.deleted).toEqual([])
  expect(await orphanKeys()).toEqual([])
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
  // Ticket 104. Same member, Session and id as the Agent Run's transcript, so
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

test('between the deploy and the old key’s drop, a sidecar beside its transcript is a 503 to retry, and transcripts still record', async () => {
  // Ticket 104's deploy order: `20260923120000` keeps the three-column key
  // for the code still live, and `20260923140000` drops it after the deploy.
  // This is the window between them, rebuilt inside the test.
  await sql`
    alter table log_artifacts
      add constraint log_artifacts_member_id_session_id_agent_id_key
        unique nulls not distinct (member_id, session_id, agent_id)
  `
  try {
    await withArchival(fixture.acme.id)
    await seedSession()
    await seedSession({ agentId: 'agent-7' })
    const base = `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/github.com-acme-api/session-1`

    // Transcripts upsert as before, twice over, on the new key.
    expect((await ask()).status).toBe(200)
    expect((await ask({ sha256: 'b'.repeat(64) })).status).toBe(200)
    expect(
      (
        await ask({
          agentId: 'agent-7',
          storageKey: `${base}/agents/agent-7.jsonl`,
        })
      ).status,
    ).toBe(200)

    // The run's sidecar collides with the old key: transient, not a 400
    // (which says "never retry") and not a 500.
    const [status, body] = await answer(
      await ask({
        agentId: 'agent-7',
        kind: 'agent_meta',
        storageKey: `${base}/agents/agent-7.meta.json`,
      }),
    )
    expect(status).toBe(503)
    expect(body).toMatchObject({ error: expect.stringMatching(/retry/) })
    expect(await artifacts()).toHaveLength(2)
  } finally {
    await sql`
      alter table log_artifacts
        drop constraint if exists log_artifacts_member_id_session_id_agent_id_key
    `
  }
})

// Ticket 129, ADR 0008: the chunked confirm records the chunks a pass sealed
// and moves the tail, in one transaction; `whole` clears them.

const MiB = 1_048_576
const base = (projectKey = 'github.com-acme-api') =>
  `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/${projectKey}/session-1`
/** Content-addressed: the seq and the first 16 hex of the raw SHA-256. */
const chunkAt = (seq: number, sha = 'd'.repeat(64), projectKey?: string) =>
  `${base(projectKey)}/chunks/${String(seq).padStart(6, '0')}-${sha.slice(0, 16)}.jsonl.gz`
/** A tail after `chunks` chunks, with the per-pass nonce the presign drew. */
const NONCE = '0123456789abcdef'
const tailAt = (chunks: number, nonce = NONCE, projectKey?: string) =>
  `${base(projectKey)}/tail-${chunks}-${nonce}.jsonl`

/** A transcript row with `chunks` sealed 1 MiB chunks, as a sealing confirm
 * would have left it. */
const seedChunked = async (chunks: number, projectKey?: string) => {
  const [artifact] = await sql<{ id: string }[]>`
    insert into log_artifacts
      (org_id, member_id, session_id, storage_key, sha256, size_bytes,
       sealed_bytes, sealed_sha256)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1',
            ${tailAt(chunks, NONCE, projectKey)}, ${'e'.repeat(64)},
            ${chunks * MiB + 10}, ${chunks * MiB}, ${'c'.repeat(64)})
    returning id
  `
  await sql`
    insert into log_artifact_chunks ${sql(
      Array.from({ length: chunks }, (_, index) => ({
        artifact_id: artifact!.id,
        member_id: fixture.acme.members.member,
        seq: index + 1,
        raw_offset: index * MiB,
        raw_length: MiB,
        stored_bytes: 200_000,
        sha256: 'd'.repeat(64),
        storage_key: chunkAt(index + 1, 'd'.repeat(64), projectKey),
      })),
    )}
  `
}

const chunkRows = () => sql<
  {
    seq: number
    raw_offset: string
    raw_length: string
    stored_bytes: string
    sha256: string
    storage_key: string
  }[]
>`
  select seq, raw_offset, raw_length, stored_bytes, sha256, storage_key
    from log_artifact_chunks order by seq
`

const sealedRow = async () =>
  (
    await sql<
      {
        storage_key: string
        size_bytes: string
        sealed_bytes: string
        sealed_sha256: string | null
        sha256: string
      }[]
    >`
      select storage_key, size_bytes, sealed_bytes, sealed_sha256, sha256
        from log_artifacts where kind = 'transcript'
    `
  )[0]

test('a steady-state chunked confirm moves the tail and touches no chunk', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(2)
  // Every pass draws a fresh nonce, so no two passes share a tail key.
  const next = tailAt(2, 'fedcba9876543210')
  stored.sizes[next] = 500

  const [status, body] = await answer(
    await ask({ layout: 'chunked', storageKey: next }),
  )

  expect(status).toBe(200)
  // Raw bytes: what is sealed plus the tail, which is what a download yields.
  expect(body).toMatchObject({ stored: true, sizeBytes: 2 * MiB + 500 })
  expect(await sealedRow()).toMatchObject({
    storage_key: next,
    size_bytes: String(2 * MiB + 500),
    sealed_bytes: String(2 * MiB),
    sha256: SHA,
  })
  expect(await chunkRows()).toHaveLength(2)
  expect(await orphanKeys()).toEqual([tailAt(2)])
})

test('a sealing confirm writes the chunk rows and moves the tail key', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  // A whole-file row, as every row before ADR 0008 is.
  await ask()
  stored.sizes = {
    [chunkAt(1, '1'.repeat(64))]: 300_000,
    [chunkAt(2, '2'.repeat(64))]: 310_000,
    [tailAt(2)]: 1234,
  }

  const [status, body] = await answer(
    await ask({
      layout: 'chunked',
      sha256: 'f'.repeat(64),
      storageKey: tailAt(2),
      sealedSha256: '9'.repeat(64),
      chunks: [
        { seq: 1, rawOffset: 0, rawLength: 1_048_600, sha256: '1'.repeat(64) },
        {
          seq: 2,
          rawOffset: 1_048_600,
          rawLength: 1_048_700,
          sha256: '2'.repeat(64),
          // A size the Collector claims is not a field of this request.
          storedBytes: 1,
          stored_bytes: 1,
        },
      ],
    }),
  )

  expect(status).toBe(200)
  expect(body).toMatchObject({
    stored: true,
    storageKey: tailAt(2),
    sizeBytes: 2_097_300 + 1234,
  })
  expect(await chunkRows()).toEqual([
    {
      seq: 1,
      raw_offset: '0',
      raw_length: '1048600',
      stored_bytes: '300000',
      sha256: '1'.repeat(64),
      storage_key: chunkAt(1, '1'.repeat(64)),
    },
    {
      seq: 2,
      raw_offset: '1048600',
      raw_length: '1048700',
      // From the HEAD, never from the body.
      stored_bytes: '310000',
      sha256: '2'.repeat(64),
      storage_key: chunkAt(2, '2'.repeat(64)),
    },
  ])
  expect(await sealedRow()).toMatchObject({
    storage_key: tailAt(2),
    size_bytes: String(2_097_300 + 1234),
    sealed_bytes: '2097300',
    sealed_sha256: '9'.repeat(64),
    sha256: 'f'.repeat(64),
  })
  // The old tail went after the commit, as any replaced key does.
  expect(await orphanKeys()).toEqual([`${base()}.jsonl`])
})

test('chunks that do not follow on from what is sealed are stale_chunks, and write nothing', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(2)
  const before = await sealedRow()
  const chunk = (seq: number, rawOffset: number) => ({
    seq,
    rawOffset,
    rawLength: MiB,
    sha256: '1'.repeat(64),
  })
  const seal = (chunks: unknown[], tail: number) =>
    ask({
      layout: 'chunked',
      sha256: 'f'.repeat(64),
      storageKey: tailAt(tail),
      sealedSha256: '9'.repeat(64),
      chunks,
    })

  for (const [chunks, tail] of [
    // Not contiguous.
    [[chunk(3, 2 * MiB), chunk(5, 3 * MiB)], 5],
    // Not starting at the next seq.
    [[chunk(4, 2 * MiB)], 4],
    // Not starting at the sealed bytes.
    [[chunk(3, 2 * MiB + 1)], 3],
    // A gap between two chunks' raw ranges.
    [[chunk(3, 2 * MiB), chunk(4, 3 * MiB + 1)], 4],
    // A tail key for a different number of chunks.
    [[chunk(3, 2 * MiB)], 4],
    [[], 3],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one at a time, so a failure names which.
    const [status, body] = await answer(await seal([...chunks], tail))
    expect([status, body.refused], JSON.stringify(chunks)).toEqual([
      200,
      'stale_chunks',
    ])
  }

  expect(await chunkRows()).toHaveLength(2)
  expect(await sealedRow()).toEqual(before)
})

test('a chunk that is not in the bucket records nothing', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  stored.sizes[chunkAt(1, SHA)] = null

  expect(
    await answer(
      await ask({
        layout: 'chunked',
        storageKey: tailAt(1),
        sealedSha256: '9'.repeat(64),
        chunks: [{ seq: 1, rawOffset: 0, rawLength: MiB, sha256: SHA }],
      }),
    ),
  ).toMatchObject([200, { refused: 'not_uploaded' }])
  expect(await artifacts()).toHaveLength(0)
  expect(await chunkRows()).toHaveLength(0)
})

test('a chunk is looked for under the key its SHA-256 addresses', async () => {
  // Content-addressed keys: a confirm naming different bytes than were
  // presigned and PUT names a different key, which is not in the bucket.
  await withArchival(fixture.acme.id)
  await seedSession()
  stored.size = null
  stored.sizes = { [chunkAt(1, '1'.repeat(64))]: 3000, [tailAt(1)]: 20 }
  const confirmWith = (sha256: string) =>
    ask({
      layout: 'chunked',
      storageKey: tailAt(1),
      sealedSha256: '9'.repeat(64),
      chunks: [{ seq: 1, rawOffset: 0, rawLength: MiB, sha256 }],
    })

  expect(await answer(await confirmWith('2'.repeat(64)))).toMatchObject([
    200,
    { refused: 'not_uploaded' },
  ])
  expect(await answer(await confirmWith('1'.repeat(64)))).toMatchObject([
    200,
    { stored: true },
  ])
  expect((await chunkRows())[0]?.storage_key).toBe(chunkAt(1, '1'.repeat(64)))
})

test('a tail key without a nonce is not this Session’s tail', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  expect(
    await answer(
      await ask({
        layout: 'chunked',
        storageKey: `${base()}/tail-1.jsonl`,
        sealedSha256: '9'.repeat(64),
        chunks: [{ seq: 1, rawOffset: 0, rawLength: MiB, sha256: SHA }],
      }),
    ),
  ).toMatchObject([200, { refused: 'stale_key' }])
})

test('a whole confirm from an older Collector clears the chunks and deletes their objects', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(2)

  // The shape every Collector before ADR 0008 sends: no layout at all.
  const [status, body] = await answer(
    await ask({ sha256: 'f'.repeat(64), storageKey: `${base()}.jsonl` }),
  )

  expect(status).toBe(200)
  expect(body).toMatchObject({ stored: true, storageKey: `${base()}.jsonl` })
  expect(await chunkRows()).toHaveLength(0)
  expect(await sealedRow()).toMatchObject({
    storage_key: `${base()}.jsonl`,
    sealed_bytes: '0',
    sealed_sha256: null,
    size_bytes: '4096',
  })
  expect(await orphanKeys()).toEqual(
    [chunkAt(1), chunkAt(2), tailAt(2)].toSorted(),
  )
})

test('replaced objects are queued in the transaction, never deleted by the confirm', async () => {
  // The sweep deletes a queued key only while no row names it again, so a
  // key a later pass reuses is kept; a direct delete after the commit had
  // no such guard.
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(1)

  expect((await ask({ storageKey: `${base()}.jsonl` })).status).toBe(200)
  expect(stored.deleted).toEqual([])

  const orphans = await sql<{ storage_key: string }[]>`
    select storage_key from storage_orphans order by storage_key
  `
  expect(orphans.map((row) => row.storage_key)).toEqual(
    [chunkAt(1), tailAt(1)].toSorted(),
  )
})

test('a confirm that records a key takes it out of storage_orphans', async () => {
  // An earlier replace could not delete this key and queued it; the key is
  // live again now, so the sweep must not be left holding it.
  await withArchival(fixture.acme.id)
  await seedSession()
  await sql`
    insert into storage_orphans (storage_key)
    values (${derivedKey()}), ('unrelated.jsonl')
  `

  expect((await ask()).status).toBe(200)

  const orphans = await sql<{ storage_key: string }[]>`
    select storage_key from storage_orphans
  `
  expect(orphans.map((row) => row.storage_key)).toEqual(['unrelated.jsonl'])
})

test('an unchanged chunked confirm still short-circuits to the stored row', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(1)
  stored.size = null

  const [status, body] = await answer(
    await ask({
      layout: 'chunked',
      sha256: 'e'.repeat(64),
      storageKey: tailAt(1),
    }),
  )
  expect(status).toBe(200)
  expect(body).toMatchObject({
    stored: true,
    storageKey: tailAt(1),
    sizeBytes: MiB + 10,
  })
})

test('a Session that moved Project reseals from zero and its old chunks go', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(2, 'github.com-acme-old')

  const [, body] = await answer(
    await ask({
      layout: 'chunked',
      sha256: 'f'.repeat(64),
      storageKey: tailAt(1),
      sealedSha256: '9'.repeat(64),
      chunks: [{ seq: 1, rawOffset: 0, rawLength: MiB, sha256: SHA }],
    }),
  )

  expect(body).toMatchObject({ stored: true })
  expect((await chunkRows()).map((row) => row.storage_key)).toEqual([
    chunkAt(1, SHA),
  ])
  expect(await orphanKeys()).toEqual(
    [
      chunkAt(1, 'd'.repeat(64), 'github.com-acme-old'),
      chunkAt(2, 'd'.repeat(64), 'github.com-acme-old'),
      tailAt(2, NONCE, 'github.com-acme-old'),
    ].toSorted(),
  )
})

test('a chunked confirm to another Project’s key is still stale_key', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  expect(
    await answer(
      await ask({
        layout: 'chunked',
        storageKey: `${base('github.com-acme-other')}.jsonl`,
      }),
    ),
  ).toMatchObject([200, { refused: 'stale_key' }])
})

test('a sidecar confirm that names chunks is refused: only transcripts chunk', async () => {
  await withArchival(fixture.acme.id)
  await seedSession({ agentId: 'agent-7' })

  const [status] = await answer(
    await ask({
      agentId: 'agent-7',
      kind: 'agent_meta',
      layout: 'chunked',
      storageKey: `${base()}/agents/agent-7.meta.json`,
      sealedSha256: '9'.repeat(64),
      chunks: [{ seq: 1, rawOffset: 0, rawLength: MiB, sha256: SHA }],
    }),
  )
  expect(status).toBe(400)
  expect(await chunkRows()).toHaveLength(0)
})

test('two sealing confirms racing on one seq record it once and delete neither chunk', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await ask()
  const seal = () =>
    ask({
      layout: 'chunked',
      sha256: 'f'.repeat(64),
      storageKey: tailAt(1),
      sealedSha256: '9'.repeat(64),
      chunks: [{ seq: 1, rawOffset: 0, rawLength: MiB, sha256: SHA }],
    })

  const answers = await Promise.all(
    [seal(), seal()].map(async (each) => answer(await each)),
  )

  expect(answers.map(([status]) => status)).toEqual([200, 200])
  expect(await chunkRows()).toHaveLength(1)
  expect(stored.deleted.flat()).not.toContain(chunkAt(1, SHA))
  expect(stored.deleted.flat()).not.toContain(tailAt(1))
})

// ADR 0008: the presign records every key it signs as pending. The confirm
// takes the keys it records out of that ledger in its transaction, and a
// pass that ends any other way queues its keys for the sweep.

const pendingKeys = async () =>
  (
    await sql<{ storage_key: string }[]>`
      select storage_key from log_upload_pending order by storage_key
    `
  ).map((row) => row.storage_key)

const orphanKeys = async () =>
  (
    await sql<{ storage_key: string }[]>`
      select storage_key from storage_orphans order by storage_key
    `
  ).map((row) => row.storage_key)

const sealOne = () => ({
  layout: 'chunked',
  sha256: 'f'.repeat(64),
  storageKey: tailAt(1, '1111222233334444'),
  sealedSha256: '9'.repeat(64),
  chunks: [{ seq: 1, rawOffset: 0, rawLength: MiB, sha256: SHA }],
})

test('a recorded confirm takes its keys out of the pending ledger', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await sql`
    insert into log_upload_pending
      (storage_key, member_id, session_id, kind, expires_at)
    values ('another-pass', ${fixture.acme.members.member}, 'session-1',
            'transcript', now() + interval '1 hour')
  `

  expect((await answer(await ask(sealOne())))[1]).toMatchObject({
    stored: true,
  })

  expect(await pendingKeys()).toEqual(['another-pass'])
})

test('a key no presign signed, or whose authorisation lapsed, is not recorded', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  presigned = false

  expect(await answer(await ask(sealOne()))).toMatchObject([
    200,
    { refused: 'not_uploaded' },
  ])
  expect(await artifacts()).toHaveLength(0)
  expect(await chunkRows()).toHaveLength(0)
})

test('a stale, unchanged or refused confirm queues its pass’s keys for the sweep', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(1)
  const passKeys = (body: Parameters<typeof keysOf>[0]) =>
    keysOf(body).toSorted()

  // Lost a race: the pass sealed seq 1 again after another sealed it.
  expect((await answer(await ask(sealOne())))[1].refused).toBe('stale_chunks')
  expect(await orphanKeys()).toEqual(passKeys(sealOne()))
  expect(await pendingKeys()).toEqual([])
  await sql`delete from storage_orphans`

  // Unchanged: the row already holds these bytes, so this pass's tail is
  // nobody's.
  const unchanged = {
    layout: 'chunked',
    sha256: 'e'.repeat(64),
    storageKey: tailAt(1, 'fedcba9876543210'),
  }
  expect((await answer(await ask(unchanged)))[1].stored).toBe(true)
  expect(await orphanKeys()).toEqual([unchanged.storageKey])
  await sql`delete from storage_orphans`

  // Refused: archival was switched off between the presign and the confirm.
  await setArchival(false)
  const off = { ...unchanged, sha256: 'f'.repeat(64) }
  expect((await answer(await ask(off)))[1].refused).toBe('archival_off')
  expect(await orphanKeys()).toEqual([off.storageKey])
  expect(await pendingKeys()).toEqual([])
})

test('a confirm queues only its own Member’s pending keys', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(1)
  presigned = false
  await sql`
    insert into log_upload_pending
      (storage_key, member_id, session_id, kind, expires_at)
    values (${tailAt(1, 'fedcba9876543210')}, ${fixture.acme.members.admin},
            'session-1', 'transcript', now() + interval '1 hour')
  `

  await ask({
    layout: 'chunked',
    sha256: 'e'.repeat(64),
    storageKey: tailAt(1, 'fedcba9876543210'),
  })

  expect(await orphanKeys()).toEqual([])
  expect(await pendingKeys()).toEqual([tailAt(1, 'fedcba9876543210')])
})

test('a chunk whose raw length its stored bytes could not inflate to is refused', async () => {
  // Deflate expands at most about 1032 to 1, so a raw length past that is
  // a Collector overstating what it stored, and it would inflate size_bytes.
  await withArchival(fixture.acme.id)
  await seedSession()
  stored.sizes = { [chunkAt(1, SHA)]: 1000 }
  const confirmWith = (rawLength: number) =>
    ask({
      layout: 'chunked',
      storageKey: tailAt(1),
      sealedSha256: '9'.repeat(64),
      chunks: [{ seq: 1, rawOffset: 0, rawLength, sha256: SHA }],
    })

  const [status, body] = await answer(await confirmWith(1000 * 1032 + 1))
  expect(status).toBe(400)
  expect(body.detail).toMatch(/rawLength/)
  expect(await artifacts()).toHaveLength(0)

  expect((await answer(await confirmWith(1000 * 1032)))[1]).toMatchObject({
    stored: true,
  })
})
