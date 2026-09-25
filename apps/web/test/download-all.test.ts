import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { beforeEach, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 140: the zip of every transcript, proven per Role against the real
// `log_artifacts_read` policy. Storage is a map; the session is faked; the
// statement, the policies and the zip are real. The zip is opened by Python's
// `zipfile`, so what is asserted is what a person would unpack.

const session = vi.hoisted(() => ({ userId: null as string | null }))
const objects = vi.hoisted(() => new Map<string, Uint8Array>())
const cancelled = vi.hoisted(() => new Set<string>())

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser }
})
vi.mock('../lib/supabase/server', () => {
  const who = async () =>
    session.userId === null
      ? null
      : { id: session.userId, email: 'whoever@example.test' }
  return { signedInUser: who, sessionUser: who, accountUser: who }
})
vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  storageConfigured: () => true,
  objectStream: async (key: string) => {
    const bytes = objects.get(key)
    if (!bytes) return null
    return new ReadableStream<Uint8Array>({
      pull: (controller) => {
        controller.enqueue(new Uint8Array(bytes))
        controller.close()
      },
      cancel: () => {
        cancelled.add(key)
      },
    })
  },
}))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  objects.clear()
  cancelled.clear()
  session.userId = null
  vi.resetModules()
})

const store = async ({
  member,
  org = 'acme',
  sessionId,
  projectId = null,
  uploadedAt = '2026-09-20T12:00:00Z',
}: {
  member: keyof Fixture['acme']['members']
  org?: 'acme' | 'globex'
  sessionId: string
  projectId?: string | null
  uploadedAt?: string
}) => {
  const key = `orgs/${fixture[org].id}/${member}/${sessionId}.jsonl`
  objects.set(key, new TextEncoder().encode(`${sessionId}\n`))
  await sql`
    insert into log_artifacts ${sql({
      org_id: fixture[org].id,
      member_id: fixture[org].members[member],
      project_id: projectId,
      session_id: sessionId,
      storage_key: key,
      sha256: 'a'.repeat(64),
      size_bytes: sessionId.length + 1,
      uploaded_at: uploadedAt,
    })}
  `
}

/** The zip as `{ path: contents }`, read by somebody else's reader. */
const unzip = async (answer: Response) => {
  const dir = mkdtempSync(join(tmpdir(), 'all-'))
  try {
    const file = join(dir, 'all.zip')
    writeFileSync(file, new Uint8Array(await answer.arrayBuffer()))
    return z.record(z.string(), z.string()).parse(
      JSON.parse(
        execFileSync(
          'python3',
          [
            '-c',
            `import json, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))`,
            file,
          ],
          { encoding: 'utf8' },
        ),
      ),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const download = async (role: keyof Fixture['acme']['users'], query = '') => {
  session.userId = fixture.acme.users[role]
  const { GET } = await import('../app/api/logs/download-all/route')
  return GET(
    new Request(`https://sessclone.test/api/logs/download-all?${query}`),
  )
}

const sessionsIn = async (answer: Response) => {
  expect(answer.status).toBe(200)
  return Object.values(await unzip(answer))
    .map((text) => text.trim())
    .toSorted()
}

test('each Role gets exactly what it can download one at a time', async () => {
  await store({ member: 'owner', sessionId: 'owner-s' })
  await store({ member: 'member', sessionId: 'member-s' })
  await store({ member: 'managerWithoutScope', sessionId: 'mws-s' })
  await store({ member: 'removed', sessionId: 'removed-s' })
  // Another Org's, which nobody here may have.
  await store({ member: 'member', org: 'globex', sessionId: 'globex-s' })

  const everyone = ['member-s', 'mws-s', 'owner-s', 'removed-s']
  expect(await sessionsIn(await download('owner'))).toEqual(everyone)
  expect(await sessionsIn(await download('admin'))).toEqual(everyone)
  // The Manager's Scope is the one Member.
  expect(await sessionsIn(await download('manager'))).toEqual(['member-s'])
  expect(await sessionsIn(await download('managerWithoutScope'))).toEqual([
    'mws-s',
  ])
  expect(await sessionsIn(await download('member'))).toEqual(['member-s'])
})

test('a folder per person, then per Project', async () => {
  const [project] = await sql<{ id: string }[]>`
    insert into projects (org_id, key)
    values (${fixture.acme.id}, 'github.com/acme/api') returning id
  `
  await store({ member: 'member', sessionId: 's-1', projectId: project!.id })
  await store({ member: 'member', sessionId: 's-2' })

  expect(Object.keys(await unzip(await download('owner'))).toSorted()).toEqual([
    'member@acme.test/github.com-acme-api/s-1.jsonl',
    'member@acme.test/outside-a-repository/s-2.jsonl',
  ])
})

test('the filters narrow the zip, and never widen it', async () => {
  const [project] = await sql<{ id: string }[]>`
    insert into projects (org_id, key)
    values (${fixture.acme.id}, 'github.com/acme/api') returning id
  `
  const [device] = await sql<{ id: string }[]>`
    insert into devices (member_id, key)
    values (${fixture.acme.members.member}, 'host:laptop') returning id
  `
  await store({
    member: 'member',
    sessionId: 'in-project',
    projectId: project!.id,
  })
  await store({
    member: 'member',
    sessionId: 'on-laptop',
    uploadedAt: '2026-08-01T12:00:00Z',
  })
  await store({ member: 'owner', sessionId: 'owners' })
  await sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      device_id: device!.id,
      session_id: 'on-laptop',
      message_id: 'msg_1',
      occurred_at: '2026-08-01T11:00:00Z',
      model: 'claude-opus-4-6',
    })}
  `

  const ask = (role: 'owner' | 'manager', query: Record<string, string>) =>
    download(role, new URLSearchParams(query).toString()).then(sessionsIn)

  expect(await ask('owner', { project: project!.id })).toEqual(['in-project'])
  expect(await ask('owner', { project: 'none' })).toEqual([
    'on-laptop',
    'owners',
  ])
  expect(await ask('owner', { device: device!.id })).toEqual(['on-laptop'])
  expect(await ask('owner', { member: fixture.acme.members.owner })).toEqual([
    'owners',
  ])
  expect(await ask('owner', { from: '2026-09-01', to: '2026-09-30' })).toEqual([
    'in-project',
    'owners',
  ])
  expect(await ask('owner', { to: '2026-08-01' })).toEqual(['on-laptop'])
  // A Member outside the Manager's Scope, asked for by id: nothing, not theirs.
  const refused = await download(
    'manager',
    `member=${fixture.acme.members.owner}`,
  )
  expect(refused.status).toBe(404)
})

test('a chunked transcript is assembled whole: chunks gunzipped, then its tail', async () => {
  const head = new TextEncoder().encode('{"line":1}\n')
  const tail = `orgs/${fixture.acme.id}/s/tail-1-0123456789abcdef.jsonl`
  objects.set(tail, new TextEncoder().encode('{"line":2}\n'))
  objects.set(`${tail}.chunk`, gzipSync(head))
  const [row] = await sql<{ id: string }[]>`
    insert into log_artifacts ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: 's',
      storage_key: tail,
      sha256: 'a'.repeat(64),
      size_bytes: 22,
      sealed_bytes: head.length,
      sealed_sha256: createHash('sha256').update(head).digest('hex'),
    })}
    returning id
  `
  await sql`
    insert into log_artifact_chunks
      (artifact_id, member_id, seq, raw_offset, raw_length, stored_bytes,
       sha256, storage_key)
    values (${row!.id}, ${fixture.acme.members.member}, 1, 0, ${head.length},
            30, ${createHash('sha256').update(head).digest('hex')},
            ${`${tail}.chunk`})
  `

  expect(await unzip(await download('member'))).toEqual({
    'member@acme.test/outside-a-repository/s.jsonl': '{"line":1}\n{"line":2}\n',
  })
})

test('refuses filters it did not send, the signed out, and a locked Org', async () => {
  await store({ member: 'member', sessionId: 'member-s' })

  expect((await download('owner', 'member=not-a-uuid')).status).toBe(400)
  expect((await download('owner', 'from=2026-13-01')).status).toBe(400)

  session.userId = null
  const { GET } = await import('../app/api/logs/download-all/route')
  expect(
    (await GET(new Request('https://sessclone.test/api/logs/download-all')))
      .status,
  ).toBe(401)

  vi.stubEnv('SIGNUP_APPROVAL', undefined)
  try {
    vi.resetModules()
    expect((await download('member')).status).toBe(403)
  } finally {
    vi.unstubAllEnvs()
  }
})

test('an entry left before its body is read closes its storage stream', async () => {
  const { archiveEntries } = await import('../lib/transcript-archive')
  objects.set('k/left.jsonl', new TextEncoder().encode('x\n'))
  const entries = archiveEntries(
    [
      {
        memberId: fixture.acme.members.member,
        person: 'member@acme.test',
        project: null,
        sessionId: 'left',
        agentId: null,
        uploadedAt: new Date('2026-09-20T12:00:00Z'),
        sizeBytes: 2,
        storageKey: 'k/left.jsonl',
        chunks: [],
      },
    ],
    new AbortController().signal,
  )
  // The client goes while the entry's header is out.
  expect((await entries.next()).done).toBe(false)
  await entries.return(undefined)
  expect([...cancelled]).toEqual(['k/left.jsonl'])
})
