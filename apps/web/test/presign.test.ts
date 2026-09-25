import { beforeEach, expect, test, vi } from 'vitest'

import { POST } from '../app/api/logs/presign/route'
import { generateApiKey } from '../lib/api-keys'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 58: the presign route and its five refusals, against a real Postgres
// with the real migrations.
//
// The signer is stubbed and nothing else is. What this file is about is who
// may upload what — which is a question about rows, the resolved Project and
// the stored hash — and a real SigV4 signature would prove none of it while
// requiring a bucket to point at.

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  storageConfigured: () => true,
  presignUpload: async (key: string) => `https://storage.test/${key}?signed`,
}))

let fixture: Fixture
let key: string

const issueKey = async (memberId: string) => {
  const { key: plaintext, prefix, hash } = generateApiKey()
  await sql`
    insert into api_keys (member_id, label, key_hash, key_prefix)
    values (${memberId}, 'laptop', ${hash}, ${prefix})
  `
  return plaintext
}

/** A Tier that includes archival, and the Org on it. Archival is a Tier
 * capability, so without this every request is refused before anything else
 * is looked at. */
const withArchival = async (orgId: string, available = true) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, archival_available, sort_order)
    values (${`tier-${orgId.slice(0, 8)}-${available}`}, 'Team', 10,
            ${available}, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${orgId}, ${tier!.id}, 'active')
    on conflict (org_id) do update set tier_id = excluded.tier_id
  `
}

/** A Project, and a Turn placing the Session in it — which is the only thing
 * that tells this route where a Session belongs. */
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
      message_id: `msg_${sessionId}_${agentId ?? 'main'}`,
      occurred_at: new Date(),
      model: 'claude-opus-4-6',
      input_tokens: 10,
    })}
  `
  return projectId
}

const SHA = 'a'.repeat(64)

const ask = async (
  body: Record<string, unknown> = {},
  presented: string | null = key,
) =>
  POST(
    new Request('https://sessclone.test/api/logs/presign', {
      method: 'POST',
      headers: presented
        ? {
            authorization: `Bearer ${presented}`,
            'content-type': 'application/json',
          }
        : { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', sha256: SHA, ...body }),
    }),
  )

const answer = async (response: Response) =>
  [response.status, await response.json()] as const

beforeEach(async () => {
  fixture = await seedFixture()
  key = await issueKey(fixture.acme.members.member)
  await setArchival(true)
})

/** Archival is the Member's own switch, and the column guard enforces that —
 * so the fixture flips it as that Member rather than on the owning
 * connection. */
const setArchival = (enabled: boolean) =>
  asUser(
    fixture.acme.users.member,
    (tx) =>
      tx`update members set archival_enabled = ${enabled}
          where id = ${fixture.acme.members.member}`,
  )

test('a Member who has opted in gets a URL for their own Session', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const [status, body] = await answer(await ask())

  expect(status).toBe(200)
  // The key carries Org, Member and Project, and the Project key is one
  // percent-encoded segment (ADR 0003) — raw it would break the prefix a
  // per-Project sweep depends on.
  expect(body.storageKey).toBe(
    `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/github.com-acme-api/session-1.jsonl`,
  )
  expect(body.url).toContain(body.storageKey)
  expect(body.expiresIn).toBeGreaterThan(0)
  expect(body.kind).toBe('transcript')
})

test('the answer echoes the kind it was issued for, so a Collector can trust it with a sidecar', async () => {
  await withArchival(fixture.acme.id)
  await seedSession({ agentId: 'agent-7' })

  const [, body] = await answer(
    await ask({ agentId: 'agent-7', kind: 'agent_meta' }),
  )

  expect(body.kind).toBe('agent_meta')
  expect(body.storageKey).toContain('/agents/agent-7.meta.json')
})

test('an Agent Run is its own object under the Session', async () => {
  await withArchival(fixture.acme.id)
  await seedSession({ agentId: 'agent-7' })

  const [, body] = await answer(await ask({ agentId: 'agent-7' }))

  expect(body.storageKey).toContain('/session-1/agents/agent-7.jsonl')
})

test('no key, an unknown key and a revoked key are one answer', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const { key: unknown } = generateApiKey()
  const revoked = await issueKey(fixture.acme.members.member)
  await sql`update api_keys set revoked_at = now() where key_prefix = ${revoked.slice(0, 12)}`

  const answers = await Promise.all(
    [null, 'sk_nonsense', unknown, revoked].map(async (presented) =>
      answer(await ask({}, presented)),
    ),
  )

  for (const [status, body] of answers) {
    expect(status).toBe(401)
    expect(body.error).toBe('no live API key was presented')
  }
})

test('the stored hash refuses the upload before the bytes move', async () => {
  await withArchival(fixture.acme.id)
  const projectId = await seedSession()
  await sql`
    insert into log_artifacts (org_id, member_id, project_id, session_id,
                               storage_key, sha256, size_bytes)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, ${projectId},
            'session-1', 'orgs/x/session-1.jsonl', ${SHA}, 10)
  `

  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'unchanged' },
  ])

  // A transcript that grew has a different hash, and is not refused.
  expect(await answer(await ask({ sha256: 'b'.repeat(64) }))).toMatchObject([
    200,
    { storageKey: expect.stringContaining('session-1.jsonl') },
  ])
})

test('the master switch being off is its own refusal', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await setArchival(false)

  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'archival_off' },
  ])
})

test('an excluded Project is refused, distinguishably from the switch', async () => {
  await withArchival(fixture.acme.id)
  const projectId = await seedSession()
  await sql`
    insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, ${projectId}, false)
  `

  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'project_excluded' },
  ])
})

test('a Tier without archival is refused, distinguishably from both', async () => {
  await withArchival(fixture.acme.id, false)
  await seedSession()

  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'tier_excludes_archival' },
  ])

  // And an Org with no subscription at all is the same answer: no Tier is no
  // entitlement, not every entitlement (ADR 0004).
  await sql`delete from subscriptions where org_id = ${fixture.acme.id}`
  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'tier_excludes_archival' },
  ])
})

test('a Session with no ingested Turns is refused transiently', async () => {
  await withArchival(fixture.acme.id)

  expect(await answer(await ask({ sessionId: 'never-seen' }))).toMatchObject([
    200,
    { refused: 'no_turns' },
  ])
})

test('a Session with Turns but no repository still archives', async () => {
  // Work outside any git repository has a transcript too, and its Project is
  // genuinely null — which must not read as "not ingested yet".
  await withArchival(fixture.acme.id)
  await seedSession({ projectKey: null })

  const [, body] = await answer(await ask())
  expect(body.storageKey).toContain('/projects/none/session-1.jsonl')
})

test('somebody else’s Session is not this Member’s to upload', async () => {
  await withArchival(fixture.acme.id)
  // The Session belongs to another Member of the same Org, so the caller's own
  // Turns do not place it — and a Project resolved from anybody's Turns would
  // be exactly the cross-Member read this route must not do.
  await seedSession({ memberId: fixture.acme.members.manager })

  expect(await answer(await ask())).toMatchObject([
    200,
    { refused: 'no_turns' },
  ])
})

test('a request that is not a presign request is refused with a reason', async () => {
  await withArchival(fixture.acme.id)

  const [status, body] = await answer(await ask({ sha256: 'not-a-hash' }))
  expect(status).toBe(400)
  expect(body.detail).toContain('sha256')
})

test('a subscription that is not active entitles nothing', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  // Sequential on purpose: each iteration rewrites the same row.
  // oxlint-disable no-await-in-loop
  for (const status of ['cancelled', 'past_due', 'inactive']) {
    await sql`
      update subscriptions set status = ${status}
       where org_id = ${fixture.acme.id}
    `
    expect(await answer(await ask())).toMatchObject([
      200,
      { refused: 'tier_excludes_archival' },
    ])
  }
  // oxlint-enable no-await-in-loop
})

test('another Member’s stored transcript is not this one’s hash oracle', async () => {
  await withArchival(fixture.acme.id)
  const projectId = await seedSession()
  await sql`
    insert into log_artifacts (org_id, member_id, project_id, session_id,
                               storage_key, sha256, size_bytes)
    values (${fixture.acme.id}, ${fixture.acme.members.manager}, ${projectId},
            'session-1', 'orgs/x/theirs.jsonl', ${SHA}, 10)
  `

  // Same Session id, somebody else's row: `unchanged` here would tell the
  // caller what another Member's transcript hashes to.
  const [, body] = await answer(await ask())
  expect(body.storageKey).toContain('session-1.jsonl')
})

test('a deployment with no storage says so rather than issuing a dead URL', async () => {
  const storage = await import('../lib/storage')
  const configured = vi
    .spyOn(storage, 'storageConfigured')
    .mockReturnValue(false)
  try {
    const [status, body] = await answer(await ask())
    expect(status).toBe(503)
    expect(body.error).toContain('storage')
  } finally {
    configured.mockRestore()
  }
})

// Ticket 129, ADR 0008: a Collector that asks for the chunked layout is told
// what is already sealed and gets URLs for its new chunks and its tail.

const base = (projectKey = 'github.com-acme-api') =>
  `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/${projectKey}/session-1`

/** A transcript row with `chunks` sealed chunks of 1 MiB each, as the
 * confirm route would have left it. */
/** What a sealing ask names: each planned chunk's seq and raw SHA-256. */
const planned = (...seqs: number[]) =>
  seqs.map((seq) => ({ seq, sha256: String(seq % 10).repeat(64) }))

/** A tail key after `chunks` chunks, with any per-pass nonce. */
const tailPattern = (dir: string, chunks: number) =>
  new RegExp(
    `^${dir.replaceAll('.', '\\.')}/tail-${chunks}-[0-9a-f]{16}\\.jsonl$`,
  )

const seedChunked = async (chunks: number, projectKey?: string) => {
  const dir = base(projectKey)
  const [artifact] = await sql<{ id: string }[]>`
    insert into log_artifacts
      (org_id, member_id, session_id, storage_key, sha256, size_bytes,
       sealed_bytes, sealed_sha256)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1',
            ${`${dir}/tail-${chunks}-0123456789abcdef.jsonl`}, ${'b'.repeat(64)},
            ${chunks * 1_048_576 + 10}, ${chunks * 1_048_576}, ${'c'.repeat(64)})
    returning id
  `
  for (let seq = 1; seq <= chunks; seq++) {
    // oxlint-disable-next-line no-await-in-loop -- a handful of fixture rows.
    await sql`
      insert into log_artifact_chunks
        (artifact_id, member_id, seq, raw_offset, raw_length, stored_bytes,
         sha256, storage_key)
      values (${artifact!.id}, ${fixture.acme.members.member}, ${seq},
              ${(seq - 1) * 1_048_576}, 1048576, 200000, ${'d'.repeat(64)},
              ${`${dir}/chunks/${String(seq).padStart(6, '0')}-dddddddddddddddd.jsonl.gz`})
    `
  }
}

test('an old-shape request is answered exactly as before', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const [status, body] = await answer(await ask())

  expect(status).toBe(200)
  // `pass` is additive: an older Collector ignores it.
  expect(Object.keys(body).toSorted()).toEqual([
    'expiresIn',
    'kind',
    'pass',
    'storageKey',
    'url',
  ])
  expect(body.storageKey).toBe(`${base()}.jsonl`)
})

test('a chunked ask with nothing sealed gets the whole-file key as its tail', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()

  const [status, body] = await answer(await ask({ layout: 'chunked' }))

  expect(status).toBe(200)
  expect(body).toMatchObject({
    layout: 'chunked',
    sealed: { bytes: 0, sha256: null, chunks: 0 },
    storageKey: `${base()}.jsonl`,
  })
  expect(body.seals).toBeUndefined()
})

test('a sealing ask gets content-addressed chunk URLs from the next seq, and a fresh tail after them', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(3)

  const [, body] = await answer(
    await ask({ layout: 'chunked', seal: planned(4, 5) }),
  )

  const four = `${base()}/chunks/000004-${'4'.repeat(16)}.jsonl.gz`
  const five = `${base()}/chunks/000005-${'5'.repeat(16)}.jsonl.gz`
  expect(body).toMatchObject({
    layout: 'chunked',
    sealed: { bytes: 3 * 1_048_576, sha256: 'c'.repeat(64), chunks: 3 },
    seals: [
      { seq: 4, storageKey: four, url: `https://storage.test/${four}?signed` },
      { seq: 5, storageKey: five, url: `https://storage.test/${five}?signed` },
    ],
  })
  expect(body.storageKey).toMatch(tailPattern(base(), 5))
  expect(body.url).toBe(`https://storage.test/${body.storageKey}?signed`)
})

test('a steady-state chunked ask gets one tail URL at the current seq, never the same key twice', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(2)

  const [, first] = await answer(await ask({ layout: 'chunked' }))
  const [, second] = await answer(await ask({ layout: 'chunked' }))

  expect(first.storageKey).toMatch(tailPattern(base(), 2))
  expect(second.storageKey).toMatch(tailPattern(base(), 2))
  expect(second.storageKey).not.toBe(first.storageKey)
  expect(first.seals).toBeUndefined()
})

test('an Agent Run chunks under its own directory', async () => {
  await withArchival(fixture.acme.id)
  await seedSession({ agentId: 'agent-7' })

  const [, body] = await answer(
    await ask({ agentId: 'agent-7', layout: 'chunked', seal: planned(1) }),
  )

  expect(body.seals[0].storageKey).toBe(
    `${base()}/agents/agent-7/chunks/000001-${'1'.repeat(16)}.jsonl.gz`,
  )
  expect(body.storageKey).toMatch(tailPattern(`${base()}/agents/agent-7`, 1))
})

test('only a transcript chunks: a sidecar asking for it is answered whole', async () => {
  await withArchival(fixture.acme.id)
  await seedSession({ agentId: 'agent-7' })

  const [, body] = await answer(
    await ask({
      agentId: 'agent-7',
      kind: 'agent_meta',
      layout: 'chunked',
      seal: planned(1),
    }),
  )

  expect(body.layout).toBeUndefined()
  expect(body.seals).toBeUndefined()
  expect(body.storageKey).toBe(`${base()}/agents/agent-7.meta.json`)
})

test('the whole-file unchanged guard still comes first for a chunked ask', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(1)

  expect(
    await answer(
      await ask({
        layout: 'chunked',
        seal: planned(2),
        sha256: 'b'.repeat(64),
      }),
    ),
  ).toMatchObject([200, { refused: 'unchanged' }])
})

test('a Session that moved Project starts sealing again from zero', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(2, 'github.com-acme-old')

  const [, body] = await answer(
    await ask({ layout: 'chunked', seal: planned(1) }),
  )

  expect(body).toMatchObject({
    sealed: { bytes: 0, sha256: null, chunks: 0 },
    seals: [
      {
        seq: 1,
        storageKey: `${base()}/chunks/000001-${'1'.repeat(16)}.jsonl.gz`,
      },
    ],
  })
  expect(body.storageKey).toMatch(tailPattern(base(), 1))
})

// ADR 0008: every key a presign signs is recorded as pending until a confirm
// records it, so an upload that is never confirmed still has a delete path.

const pending = () =>
  sql<{ storage_key: string; member_id: string; ttl: number }[]>`
    select storage_key, member_id,
           extract(epoch from expires_at - now())::int as ttl
      from log_upload_pending order by storage_key
  `

test('every key a presign signs is recorded as pending, and taken out of storage_orphans', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(1)
  const four = `${base()}/chunks/000002-${'2'.repeat(16)}.jsonl.gz`
  await sql`insert into storage_orphans (storage_key) values (${four})`

  const [, body] = await answer(
    await ask({ layout: 'chunked', seal: planned(2) }),
  )

  const rows = await pending()
  expect(rows.map((row) => row.storage_key).toSorted()).toEqual(
    [four, String(body.storageKey)].toSorted(),
  )
  for (const row of rows) {
    expect(row.member_id).toBe(fixture.acme.members.member)
    // Past the URL's own life, so a confirm that follows a slow PUT is
    // still in time; bounded, so an unconfirmed one is swept.
    expect(row.ttl).toBeGreaterThan(300)
    expect(row.ttl).toBeLessThanOrEqual(300 + 3600)
  }
  expect(await sql`select 1 from storage_orphans`).toHaveLength(0)
})

test('a refused presign records nothing as pending', async () => {
  await withArchival(fixture.acme.id)
  await seedSession()
  await seedChunked(1)

  await ask({ layout: 'chunked', sha256: 'b'.repeat(64) })

  expect(await pending()).toEqual([])
})

test('each presign draws a pass, and one the pass echoes is kept', async () => {
  // ADR 0008: a pass's later presigns and its confirm echo the id, so the
  // keys it was signed are its own and no other pass takes them.
  await withArchival(fixture.acme.id)
  await seedSession()

  const [, first] = await answer(await ask({ layout: 'chunked' }))
  const [, second] = await answer(await ask({ layout: 'chunked' }))
  expect(first.pass).toMatch(/^[0-9a-f]{16}$/)
  expect(second.pass).not.toBe(first.pass)

  const [, echoed] = await answer(
    await ask({ layout: 'chunked', pass: first.pass }),
  )
  expect(echoed.pass).toBe(first.pass)
  // Three presigns of the whole-file key, two passes: two pending rows.
  const passes = await sql<{ pass: string }[]>`
    select pass from log_upload_pending
     where storage_key = ${echoed.storageKey}
  `
  expect(passes).toHaveLength(2)
  expect(passes.map((row) => row.pass)).toEqual(
    expect.arrayContaining([first.pass, second.pass]),
  )
})
