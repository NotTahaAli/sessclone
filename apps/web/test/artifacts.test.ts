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
let refuseDelete = false
/** Runs between the row delete and the object delete, to model a race. */
let duringDelete: (() => Promise<void>) | undefined

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  deleteObjects: async (keys: string[]) => {
    await duringDelete?.()
    if (refuseDelete) throw new Error('storage is unreachable')
    deleted.push(...keys)
  },
}))

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  deleted.length = 0
  refuseDelete = false
  duringDelete = undefined
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
  projectId = null,
  projectKey = 'github.com/acme/api',
  sessionId = 'session-1',
  agentId = null,
  bytes = 1024,
}: {
  memberId?: string
  projectId?: string | null
  projectKey?: string | null
  sessionId?: string
  agentId?: string | null
  bytes?: number
} = {}) => {
  const member = memberId || fixture.acme.members.member
  const key = `orgs/${fixture.acme.id}/members/${member}/projects/${encodeURIComponent(
    projectKey ?? 'none',
  )}/${sessionId}${agentId ? `/agents/${agentId}` : ''}.jsonl`

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

  // One delete for the Project, and exactly the keys of the rows that went:
  // an object the transaction never saw is an upload that landed while the
  // sweep ran, and destroying its bytes would leave a row that outlives them.
  expect(deleted).not.toContain(untouched.key)
  expect(deleted).toHaveLength(3)

  const { projects } = await asMember(storedProjects)
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
  // Nothing left, nothing raised, and no second delete: a re-run after a
  // failure finds the rows that did not go and leaves the rest alone.
  deleted.length = 0
  expect(
    await asMember((tx) =>
      deleteStoredProject(tx, fixture.acme.members.member, projectId),
    ),
  ).toBe(0)
  expect(deleted).toEqual([])
})

test('an upload that lands during a sweep keeps its bytes', async () => {
  const projectId = await project('github.com/acme/api')
  const swept = await artifact({ projectId })

  // The window: the rows are deleted, then the objects. A Collector's upload
  // lands in it — written by the presign route with the service role, outside
  // this transaction — so its row survives the sweep. Its bytes must too, or
  // the row outlives them and the download 404s forever.
  let landed: { id: string; key: string } | undefined
  duringDelete = async () => {
    landed = await artifact({ projectId, sessionId: 'session-mid' })
  }

  await asMember((tx) =>
    deleteStoredProject(tx, fixture.acme.members.member, projectId),
  )

  expect(deleted).toEqual([swept.key])
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from log_artifacts where id = ${landed!.id}
  `
  expect(row!.count).toBe(1)
})
test('a Member sees the repository their stored Sessions belong to', async () => {
  const projectId = await project('github.com/acme/api')
  await artifact({ projectId })

  // No Turn on this Project, and a Member administers nothing — the two
  // branches `sessclone_visible_project_ids()` had before ticket 73. Without
  // the artifact branch the page groups a Member's own work under "No
  // repository" and the deletion buttons cannot tell one group from another.
  const [row] = (await asMember(storedProjects)).projects
  expect(row).toMatchObject({
    projectId,
    projectKey: 'github.com/acme/api',
    sessions: 1,
  })
})

test('the Session list is read from an index rather than sorted', async () => {
  const projectId = await project('github.com/acme/api')
  // Enough history for the planner to have a choice: on three rows a
  // sequential scan wins whatever the indexes say, which would make this
  // test agree with anything.
  await sql`
    insert into log_artifacts (org_id, member_id, project_id, session_id,
                               storage_key, sha256, size_bytes, uploaded_at)
    select ${fixture.acme.id}, ${fixture.acme.members.member}, ${projectId},
           'session-' || n,
           'orgs/x/members/y/projects/p/session-' || n || '.jsonl',
           ${'d'.repeat(64)}, 1024, now() - (n || ' minutes')::interval
      from generate_series(1, 2000) as n
  `
  await sql`analyze log_artifacts`

  // The page reads this on every render, and a Member archives every Session
  // they run: a plan that sorts the whole history to show the newest hundred
  // gets slower for the rest of that Member's life.
  const plan = await asMember(
    (tx) => tx<{ 'QUERY PLAN': string }[]>`
      explain (costs off)
      select id from log_artifacts
       where member_id = ${fixture.acme.members.member}
         and member_id in (select sessclone_own_member_ids())
       order by uploaded_at desc, id desc
       limit 101
    `,
  )

  const text = plan.map((row) => row['QUERY PLAN']).join('\n')
  expect(text).toContain('log_artifacts_member_uploaded_idx')
  // The index is already in the order the page asks for, so the limit stops
  // the scan instead of a sort reading everything first.
  expect(text).not.toContain('Sort Key')
})

// Ticket 84: the same two reads, for the people a viewer can see rather than
// for themselves. What decides the set is `sessclone_visible_member_ids()`,
// so these run as the unprivileged role — under the owning role every row is
// visible and the assertions would prove nothing.

test('a team listing is what each Role may see, and never more', async () => {
  await artifact({ sessionId: 'mine' })
  await artifact({
    memberId: fixture.acme.members.owner,
    sessionId: 'owners',
  })
  await sql`
    insert into log_artifacts (org_id, member_id, session_id, storage_key,
                               sha256, size_bytes)
    values (${fixture.globex.id}, ${fixture.globex.members.member},
            'globex', 'orgs/globex/session.jsonl', ${'a'.repeat(64)}, 1)
  `

  const listed = async (role: Parameters<typeof asRole>[1]) =>
    (
      await asRole(fixture.acme, role, (tx) =>
        storedSessions(tx, { audience: 'team', limit: 100 }),
      )
    ).sessions.map((session) => session.sessionId)

  // An Owner and an Admin see every Member's, and never another Org's.
  expect((await listed('owner')).toSorted()).toEqual(['mine', 'owners'])
  expect((await listed('admin')).toSorted()).toEqual(['mine', 'owners'])
  // The fixture's Scope holds the Member and not the Owner.
  expect(await listed('manager')).toEqual(['mine'])
  expect(await listed('managerWithoutScope')).toEqual([])
  // A Member's own team listing is their own rows: the policy is the whole
  // answer, so the page they cannot reach would not leak if they did.
  expect(await listed('member')).toEqual(['mine'])
})

test('a team listing names who each project belongs to', async () => {
  const projectId = await project('github.com/acme/api')
  await artifact({ projectId })

  const { projects } = await asRole(fixture.acme, 'owner', (tx) =>
    storedProjects(tx, { audience: 'team' }),
  )
  const [group] = projects

  expect(group).toMatchObject({
    memberId: fixture.acme.members.member,
    memberEmail: 'member@acme.test',
    sessions: 1,
  })

  // And a Member's own listing carries their own address rather than null, so
  // one component renders both.
  // A Manager reads the address through their Scope, which is the newest and
  // riskiest path: `users_read` resolves through `visible_user_ids`, which
  // resolves through the Scope. If it regressed the page would say "A Member"
  // for every row.
  const asManager = await asRole(fixture.acme, 'manager', (tx) =>
    storedProjects(tx, { audience: 'team' }),
  )
  expect(asManager.projects.map((one) => one.memberEmail)).toEqual([
    'member@acme.test',
  ])
})

test('a removed Member’s transcripts stay in the Org’s listing', async () => {
  // Removing somebody does not destroy what the Org holds (ADR 0005), and an
  // Owner still answering for it needs to see it.
  await artifact({ memberId: fixture.acme.members.removed, sessionId: 'left' })

  const { sessions } = await asRole(fixture.acme, 'owner', (tx) =>
    storedSessions(tx, { audience: 'team', limit: 100 }),
  )
  expect(sessions.map((session) => session.sessionId)).toEqual(['left'])
})

test('Your settings stays your own, whatever Role you hold', async () => {
  await artifact({ sessionId: 'the-members' })
  await artifact({ memberId: fixture.acme.members.owner, sessionId: 'mine' })

  // An Owner can *see* every Member's transcript, so the own listing has to
  // ask for `sessclone_own_member_ids()` rather than lean on the policy: the
  // rows on this page each carry a Delete button, and a button on somebody
  // else's transcript would be refused by `log_artifacts_delete` after the
  // press.
  const { sessions } = await asRole(fixture.acme, 'owner', (tx) =>
    storedSessions(tx),
  )
  expect(sessions.map((session) => session.sessionId)).toEqual(['mine'])

  const own = await asRole(fixture.acme, 'owner', (tx) => storedProjects(tx))
  expect(own.projects.map((group) => group.memberId)).toEqual([
    fixture.acme.members.owner,
  ])
})

test('a group’s Sessions page by a cursor, with no row repeated or skipped', async () => {
  const projectId = await project('github.com/acme/api')
  for (const n of [1, 2, 3, 4, 5]) {
    // oxlint-disable-next-line no-await-in-loop -- five rows, and each needs its own timestamp
    await sql`
      insert into log_artifacts (org_id, member_id, project_id, session_id,
                                 storage_key, sha256, size_bytes, uploaded_at)
      values (${fixture.acme.id}, ${fixture.acme.members.member}, ${projectId},
              ${`session-${n}`}, ${`orgs/a/p/session-${n}.jsonl`},
              ${'a'.repeat(64)}, 1024, ${new Date(Date.now() - n * 60_000)})
    `
  }
  // Another Member's Sessions, and another Project's, to prove the group is
  // the filter rather than the page size.
  await artifact({ memberId: fixture.acme.members.owner, sessionId: 'owners' })
  await artifact({ sessionId: 'other-project' })

  const group = {
    memberId: fixture.acme.members.member,
    projectId,
  }
  const page = (before?: { uploadedAt: Date; id: string }) =>
    asRole(fixture.acme, 'owner', (tx) =>
      storedSessions(tx, { audience: 'team', limit: 2, group, before }),
    )

  const first = await page()
  expect(first.sessions.map((one) => one.sessionId)).toEqual([
    'session-1',
    'session-2',
  ])
  expect(first.more).toBe(true)

  const second = await page(first.sessions.at(-1))
  expect(second.sessions.map((one) => one.sessionId)).toEqual([
    'session-3',
    'session-4',
  ])

  const third = await page(second.sessions.at(-1))
  expect(third.sessions.map((one) => one.sessionId)).toEqual(['session-5'])
  expect(third.more).toBe(false)
})

test('a group a Manager may not see is empty rather than refused', async () => {
  const projectId = await project('github.com/acme/api')
  await artifact({ memberId: fixture.acme.members.owner, projectId })

  // The group is named in the URL, so it is the browser's word. The policy is
  // the whole answer: the Owner is outside this Manager's Scope.
  const { sessions } = await asRole(fixture.acme, 'manager', (tx) =>
    storedSessions(tx, {
      audience: 'team',
      group: { memberId: fixture.acme.members.owner, projectId },
    }),
  )
  expect(sessions).toEqual([])
})

test('a group’s Sessions are read from the index, not sorted', async () => {
  const projectId = await project('github.com/acme/api')
  await sql`
    insert into log_artifacts (org_id, member_id, project_id, session_id,
                               storage_key, sha256, size_bytes, uploaded_at)
    select ${fixture.acme.id}, ${fixture.acme.members.member}, ${projectId},
           'session-' || n,
           'orgs/x/members/y/projects/p/session-' || n || '.jsonl',
           ${'d'.repeat(64)}, 1024, now() - (n || ' minutes')::interval
      from generate_series(1, 2000) as n
  `
  await sql`analyze log_artifacts`

  // This is why a team listing pages by group: across a whole Org the id set
  // has many Members in it and the order cannot come from the index, so the
  // plan is a sort over every artifact the Org ever stored. One Member by
  // equality is the shape the index answers.
  const plan = await asRole(fixture.acme, 'owner', (tx) =>
    storedSessions(tx, {
      audience: 'team',
      group: { memberId: fixture.acme.members.member, projectId },
    }).then(
      () =>
        tx<{ 'QUERY PLAN': string }[]>`
        explain (costs off)
        select id from log_artifacts
         where member_id = ${fixture.acme.members.member}
           and member_id in (select sessclone_visible_member_ids())
           and project_id is not distinct from ${projectId}
         order by uploaded_at desc, id desc
         limit 101
      `,
    ),
  )

  const text = plan.map((row) => row['QUERY PLAN']).join('\n')
  expect(text).toContain('log_artifacts_member_uploaded_idx')
  expect(text).not.toContain('Sort Key')
})

test('a viewer in two Orgs sees both, and each group says which', async () => {
  // `sessclone_visible_member_ids()` unions every Org the caller owns or
  // administers *and* their own memberships elsewhere, so a team listing can
  // legitimately carry rows from a second Org. The page must not claim they
  // are all one Org's.
  const [second] = await sql<{ id: string }[]>`
    insert into orgs (name) values ('Second') returning id
  `
  const [elsewhere] = await sql<{ user_id: string; member_id: string }[]>`
    insert into members (org_id, user_id, role)
    values (${second!.id}, ${fixture.acme.users.owner}, 'member')
    returning user_id, id as member_id
  `
  await sql`
    insert into log_artifacts (org_id, member_id, session_id, storage_key,
                               sha256, size_bytes)
    values (${second!.id}, ${elsewhere!.member_id}, 'elsewhere',
            'orgs/second/session.jsonl', ${'a'.repeat(64)}, 1024)
  `
  await artifact({ sessionId: 'at-acme' })

  const { projects } = await asRole(fixture.acme, 'owner', (tx) =>
    storedProjects(tx, { audience: 'team' }),
  )

  expect(projects).toHaveLength(2)
  expect(
    projects.map((one) => one.orgName).toSorted((a, b) => (a! < b! ? -1 : 1)),
  ).toEqual(['Acme', 'Second'])
})
