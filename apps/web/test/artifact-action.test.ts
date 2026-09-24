import { beforeEach, expect, test, vi } from 'vitest'

import { storedProjects } from '../lib/artifacts'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 73's writes at the boundary rather than one layer under it.
//
// `artifacts.test.ts` proves what the policies and the sweep do. What it
// cannot prove is what the Server Action does first, and the action is the
// part anybody can POST to whether or not a form was rendered for them.
//
// Only `next/cache`, Supabase and storage are stubbed. The database, the
// policies and the action's own code are real.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({
  signedInUser,
  sessionUser: signedInUser,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const deleted: string[] = []
vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  deleteObjects: async (keys: string[]) => {
    deleted.push(...keys)
  },
}))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  deleted.length = 0
  vi.resetModules()
  signedInUser.mockReset()
})

/** A fresh module per case: the viewer is `cache`d for one request. */
const actAs = async (userId: string) => {
  signedInUser.mockResolvedValue({ id: userId, email: 'whoever@example.test' })
  return import('../app/(dashboard)/transcripts/artifact-actions')
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const artifact = async ({
  member = '',
  projectId = null as string | null,
  sessionId = 'session-1',
} = {}) => {
  const memberId = member || fixture.acme.members.member
  const key = `orgs/${fixture.acme.id}/members/${memberId}/projects/none/${sessionId}.jsonl`
  const [row] = await sql<{ id: string }[]>`
    insert into log_artifacts (org_id, member_id, project_id, session_id,
                               storage_key, sha256, size_bytes)
    values (${fixture.acme.id}, ${memberId}, ${projectId}, ${sessionId},
            ${key}, ${'b'.repeat(64)}, 512)
    returning id
  `
  return row!.id
}

const remaining = () =>
  asUser(fixture.acme.users.member, storedProjects).then(({ projects }) =>
    projects.reduce((total, row) => total + row.sessions, 0),
  )

test('a signed-in Member deletes their own stored Session', async () => {
  const artifactId = await artifact()
  const actions = await actAs(fixture.acme.users.member)

  await actions.deleteSession(form({ artifactId }))

  expect(deleted).toHaveLength(1)
  expect(await remaining()).toBe(0)
})

test('a whole group goes, and `none` is the group rather than a missing field', async () => {
  await artifact()
  await artifact({ sessionId: 'session-2' })
  const actions = await actAs(fixture.acme.users.member)

  await actions.deleteProject(
    form({ memberId: fixture.acme.members.member, projectId: 'none' }),
  )

  expect(await remaining()).toBe(0)
})

test('a signed-out caller deletes nothing', async () => {
  await artifact()
  signedInUser.mockResolvedValue(null)
  const actions =
    await import('../app/(dashboard)/transcripts/artifact-actions')

  await actions.deleteSession(form({ artifactId: crypto.randomUUID() }))
  await actions.deleteProject(
    form({ memberId: fixture.acme.members.member, projectId: 'none' }),
  )

  expect(deleted).toEqual([])
  expect(await remaining()).toBe(1)
})

test('an input that is not an id reaches no statement', async () => {
  await artifact()
  const actions = await actAs(fixture.acme.users.member)

  // Not a refusal to be reported: a form that posts this was not rendered by
  // this page. It stops before the transaction, so a malformed id cannot be
  // told from an unknown one either way.
  await actions.deleteSession(form({ artifactId: 'not-an-id' }))
  await actions.deleteProject(
    form({ memberId: 'not-an-id', projectId: 'none' }),
  )
  await actions.deleteProject(
    form({
      memberId: fixture.acme.members.member,
      projectId: 'neither-none-nor-an-id',
    }),
  )

  expect(deleted).toEqual([])
  expect(await remaining()).toBe(1)
})

test('another Member’s artifact is refused, whoever asks', async () => {
  // The Owner is the strongest Role in the Org and still may not destroy this
  // (ADR 0005); the action does not decide that, `log_artifacts_delete` does.
  const artifactId = await artifact()
  const actions = await actAs(fixture.acme.users.owner)

  await actions.deleteSession(form({ artifactId }))
  await actions.deleteProject(
    form({ memberId: fixture.acme.members.member, projectId: 'none' }),
  )

  expect(deleted).toEqual([])
  expect(await remaining()).toBe(1)
})

test('a signed-in Member deletes a chunked Session, chunks and all', async () => {
  // Ticket 130, through the action and the policies: the chunk rows go as
  // the Member, under `log_artifact_chunks_delete`.
  const artifactId = await artifact()
  const [row] = await sql<{ storage_key: string }[]>`
    update log_artifacts
       set sealed_bytes = 1024, sealed_sha256 = ${'c'.repeat(64)}
     where id = ${artifactId}
    returning storage_key
  `
  const chunk = `${row!.storage_key}/chunks/000001.jsonl.gz`
  await sql`
    insert into log_artifact_chunks
      (artifact_id, member_id, seq, raw_offset, raw_length, stored_bytes,
       sha256, storage_key)
    values (${artifactId}, ${fixture.acme.members.member}, 1, 0, 1024, 300,
            ${'d'.repeat(64)}, ${chunk})
  `
  const actions = await actAs(fixture.acme.users.member)

  await actions.deleteSession(form({ artifactId }))

  expect(deleted.toSorted()).toEqual([row!.storage_key, chunk].toSorted())
  expect(await sql`select 1 from log_artifact_chunks`).toHaveLength(0)
  expect(await remaining()).toBe(0)
})
