import { beforeEach, expect, test, vi } from 'vitest'

import {
  deleteStoredProject,
  deleteStoredSession,
  storedProjects,
  storedSessions,
} from '../lib/artifacts'
import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'

// Ticket 73: destroying transcripts that are already stored.
//
// Storage is stubbed and the database is not. What this file is about is who
// may destroy what, and whether the row and the object go together — neither
// of which a real bucket would prove better, and one of which needs a bucket
// that refuses on demand.

const deleted: string[] = []
const listed: string[] = []
let refuseDelete = false

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  deleteObjects: async (keys: string[]) => {
    if (refuseDelete) throw new Error('storage is unreachable')
    deleted.push(...keys)
  },
  keysUnder: async (prefix: string) => {
    listed.push(prefix)
    return stored.filter((key) => key.startsWith(prefix))
  },
}))

/** What the fake bucket holds, so a prefix listing has something to find. */
let stored: string[] = []

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  deleted.length = 0
  listed.length = 0
  stored = []
  refuseDelete = false
})

const project = async (key: string) => {
  const [row] = await sql<{ id: string }[]>`
    insert into projects (org_id, key) values (${fixture.acme.id}, ${key})
    returning id
  `
  return row!.id
}

/** An uploaded transcript, as the presign route's caller would have written. */
const artifact = async ({
  memberId = '',
  projectId = null as string | null,
  projectKey = 'github.com/acme/api' as string | null,
  sessionId = 'session-1',
  agentId = null as string | null,
  bytes = 1024,
} = {}) => {
  const member = memberId || fixture.acme.members.member
  const key = `orgs/${fixture.acme.id}/members/${member}/projects/${encodeURIComponent(
    projectKey ?? 'none',
  )}/${sessionId}${agentId ? `/agents/${agentId}` : ''}.jsonl`
  stored.push(key)

  const [row] = await sql<{ id: string }[]>`
    insert into log_artifacts (org_id, member_id, project_id, session_id,
                               agent_id, storage_key, sha256, size_bytes)
    values (${fixture.acme.id}, ${member}, ${projectId}, ${sessionId},
            ${agentId}, ${key}, ${'a'.repeat(64)}, ${bytes})
    returning id
  `
  return { id: row!.id, key }
}

const asMember = <T>(query: Parameters<typeof asUser<T>>[1]) =>
  asUser(fixture.acme.users.member, query)

test('a Member destroys one Session, and the object goes with the row', async () => {
  const projectId = await project('github.com/acme/api')
  const one = await artifact({ projectId })
  const other = await artifact({ projectId, sessionId: 'session-2' })

  expect(await asMember((tx) => deleteStoredSession(tx, one.id))).toBe(true)

  expect(deleted).toEqual([one.key])
  const { sessions } = await asMember(storedSessions)
  expect(sessions.map((session) => session.id)).toEqual([other.id])
})

test('a whole Project goes at once, swept by the key’s prefix', async () => {
  const projectId = await project('github.com/acme/api')
  await artifact({ projectId })
  await artifact({ projectId, sessionId: 'session-2' })
  await artifact({ projectId, sessionId: 'session-2', agentId: 'agent-7' })
  // Another Project of the same Member, which must survive.
  const otherId = await project('github.com/acme/web')
  const untouched = await artifact({
    projectId: otherId,
    projectKey: 'github.com/acme/web',
    sessionId: 'session-3',
  })

  expect(
    await asMember((tx) =>
      deleteStoredProject(tx, fixture.acme.members.member, projectId),
    ),
  ).toBe(3)

  // One list and one delete, rather than a request per object.
  expect(listed).toEqual([
    `orgs/${fixture.acme.id}/members/${fixture.acme.members.member}/projects/${encodeURIComponent('github.com/acme/api')}/`,
  ])
  expect(deleted).not.toContain(untouched.key)
  expect(deleted).toHaveLength(3)

  const projects = await asMember(storedProjects)
  expect(projects.map((row) => row.projectId)).toEqual([otherId])
})

test('Sessions with no repository are their own group, and sweep on their own', async () => {
  const projectId = await project('github.com/acme/api')
  const kept = await artifact({ projectId })
  await artifact({ projectId: null, projectKey: null, sessionId: 'session-9' })

  expect(
    await asMember((tx) =>
      deleteStoredProject(tx, fixture.acme.members.member, null),
    ),
  ).toBe(1)

  expect(deleted).toHaveLength(1)
  expect(deleted).not.toContain(kept.key)
})

test('nobody destroys another Member’s transcripts, the Owner included', async () => {
  const projectId = await project('github.com/acme/api')
  const theirs = await artifact({ projectId })

  // `log_artifacts_delete` is `sessclone_own_member_ids()`, narrower than the
  // read policy beside it: an Owner may download this and may not destroy it.
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      deleteStoredSession(tx, theirs.id),
    ),
  ).toBe(false)
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      deleteStoredProject(tx, fixture.acme.members.member, projectId),
    ),
  ).toBe(0)

  expect(deleted).toEqual([])
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from log_artifacts where id = ${theirs.id}
  `
  expect(row!.count).toBe(1)
})

test('a storage failure leaves the row, rather than a row with no bytes', async () => {
  const projectId = await project('github.com/acme/api')
  const one = await artifact({ projectId })
  refuseDelete = true

  // The row is deleted inside the transaction and the object next, so a
  // storage failure rolls the row back: the two are both there or both gone.
  await expect(
    asMember((tx) => deleteStoredSession(tx, one.id)),
  ).rejects.toThrow(/storage is unreachable/)

  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from log_artifacts where id = ${one.id}
  `
  expect(row!.count).toBe(1)
})

test('deleting a transcript leaves the Session’s Turns and its Cost alone', async () => {
  const projectId = await project('github.com/acme/api')
  const one = await artifact({ projectId })
  await sql`
    insert into turns (org_id, member_id, project_id, session_id, message_id,
                       occurred_at, model, input_tokens)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, ${projectId},
            'session-1', 'msg_1', now(), 'claude-opus-4-6', 1000)
  `

  await asMember((tx) => deleteStoredSession(tx, one.id))

  // Spend history is not what this destroys: usage and cost are always
  // reported, and archival is the separate thing (ADR 0005).
  const [turn] = await sql<{ count: number }[]>`
    select count(*)::int as count from turns where session_id = 'session-1'
  `
  expect(turn!.count).toBe(1)
  const [cost] = await sql<{ count: number }[]>`
    select count(*)::int as count
      from turn_costs cost
      join turns turn on turn.id = cost.turn_id
     where turn.session_id = 'session-1'
  `
  expect(cost!.count).toBe(1)
})

test('deleting is not an opt-out: the same Session may upload again', async () => {
  const projectId = await project('github.com/acme/api')
  const one = await artifact({ projectId })
  await asMember((tx) => deleteStoredSession(tx, one.id))

  // The switches decide what uploads, and this touched neither. The only
  // thing the deleted row changes is that the unchanged-hash refusal no
  // longer applies to it, which is what lets the next upload land.
  const [member] = await sql<{ archival_enabled: boolean }[]>`
    select archival_enabled from members
     where id = ${fixture.acme.members.member}
  `
  expect(member!.archival_enabled).toBe(false)
  const [exception] = await sql<{ count: number }[]>`
    select count(*)::int as count from member_project_archival
     where member_id = ${fixture.acme.members.member}
  `
  expect(exception!.count).toBe(0)

  const again = await artifact({ projectId })
  expect(
    (await asMember(storedSessions)).sessions.map((session) => session.id),
  ).toEqual([again.id])
})

test('a sweep is safe to run twice', async () => {
  const projectId = await project('github.com/acme/api')
  await artifact({ projectId })

  expect(
    await asMember((tx) =>
      deleteStoredProject(tx, fixture.acme.members.member, projectId),
    ),
  ).toBe(1)
  // Nothing left, nothing raised: deleting an object that is not there
  // succeeds, which is what makes a re-run safe after a partial failure.
  expect(
    await asMember((tx) =>
      deleteStoredProject(tx, fixture.acme.members.member, projectId),
    ),
  ).toBe(0)
})

test('a Member sees the repository their stored Sessions belong to', async () => {
  const projectId = await project('github.com/acme/api')
  await artifact({ projectId })

  // No Turn on this Project, and a Member administers nothing — the two
  // branches `sessclone_visible_project_ids()` had before ticket 73. Without
  // the artifact branch the page groups a Member's own work under "No
  // repository" and the deletion buttons cannot tell one group from another.
  const [row] = await asMember(storedProjects)
  expect(row).toMatchObject({
    projectId,
    projectKey: 'github.com/acme/api',
    sessions: 1,
  })
})
