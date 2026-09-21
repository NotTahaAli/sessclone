import { beforeEach, describe, expect, test } from 'vitest'

import {
  listArchivalMemberships,
  listArchivalProjects,
  setArchivalEnabled,
  setProjectArchival,
} from '../lib/archival'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 72. ADR 0005's two controls, proved on the connection the dashboard
// uses: `asUser` is `sessclone_app`, which owns nothing and bypasses nothing,
// so a refusal here is the policy refusing and not the test being polite.
//
// The Role matrix for these tables is ticket 44's (`rls.test.ts`). What this
// file adds is the surface's own questions: does the switch start off, does
// the list name every Project the Member could exclude, and does a write
// aimed at somebody else land anywhere.

let fixture: Fixture

/** A Project in an Org, and the one Turn that puts a Member in it. */
const seedProject = async (
  org: { id: string },
  memberId: string,
  key: string,
  remote: string | null = null,
) => {
  const [project] = await sql<{ id: string }[]>`
    insert into projects (org_id, key, remote)
    values (${org.id}, ${key}, ${remote})
    returning id
  `

  await sql`
    insert into turns (org_id, member_id, project_id, session_id, message_id, occurred_at)
    values (${org.id}, ${memberId}, ${project!.id}, ${key}, ${`msg-${key}`}, now())
  `

  return project!.id
}

beforeEach(async () => {
  fixture = await seedFixture()
})

describe('the master switch', () => {
  test('starts off, which is ADR 0005 default and not a seeding accident', async () => {
    const memberships = await asUser(
      fixture.acme.users.member,
      listArchivalMemberships,
    )

    expect(memberships).toHaveLength(1)
    expect(memberships[0]).toMatchObject({
      member_id: fixture.acme.members.member,
      org_name: 'Acme',
      archival_enabled: false,
    })
  })

  test('is the Member own to turn on and off', async () => {
    const on = await asUser(fixture.acme.users.member, (tx) =>
      setArchivalEnabled(tx, fixture.acme.members.member, true),
    )
    expect(on).toBe(1)

    const [after] = await sql<{ archival_enabled: boolean }[]>`
      select archival_enabled from members
       where id = ${fixture.acme.members.member}
    `
    expect(after!.archival_enabled).toBe(true)

    const off = await asUser(fixture.acme.users.member, (tx) =>
      setArchivalEnabled(tx, fixture.acme.members.member, false),
    )
    expect(off).toBe(1)
  })

  test('is nobody else to write, whatever Role they hold', async () => {
    // Three layers, and this asserts the outermost: the statement's own
    // intersection with `sessclone_own_member_ids()` means the row is never
    // named, so nothing is updated and nothing is disclosed about whether that
    // membership exists. Behind it, `members_write` and the column guard
    // trigger refuse the same write spelled by hand — `rls.test.ts` proves
    // that half, which is the one a future statement here would rely on.
    for (const userId of [
      fixture.acme.users.owner,
      fixture.acme.users.admin,
      fixture.acme.users.manager,
      fixture.globex.users.owner,
      fixture.stranger.userId,
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- five viewers, order is clearer.
      const changed = await asUser(userId, (tx) =>
        setArchivalEnabled(tx, fixture.acme.members.member, true),
      )
      expect(changed).toBe(0)
    }

    const [after] = await sql<{ archival_enabled: boolean }[]>`
      select archival_enabled from members
       where id = ${fixture.acme.members.member}
    `
    expect(after!.archival_enabled).toBe(false)
  })
})

describe('the Project list', () => {
  test('names every Project the Member has Sessions in, `local:` ones included', async () => {
    const remote = await seedProject(
      fixture.acme,
      fixture.acme.members.member,
      'github.com/acme/api',
      'git@github.com:acme/api.git',
    )
    const local = await seedProject(
      fixture.acme,
      fixture.acme.members.member,
      'local:build-box:/home/dev/scratch',
    )

    const projects = await asUser(
      fixture.acme.users.member,
      listArchivalProjects,
    )

    // By key, so the list does not reorder itself between renders.
    expect(projects.map((p) => p.project_id)).toEqual([remote, local])
    expect(projects.map((p) => p.key)).toEqual([
      'github.com/acme/api',
      'local:build-box:/home/dev/scratch',
    ])
    // No row yet: the Project inherits the master switch, which is what the
    // surface has to be able to say.
    expect(projects.every((p) => p.archival_enabled === null)).toBe(true)
  })

  test('does not name another Member Projects, whoever is asking', async () => {
    await seedProject(
      fixture.acme,
      fixture.acme.members.owner,
      'github.com/acme/private',
    )

    const asMember = await asUser(
      fixture.acme.users.member,
      listArchivalProjects,
    )
    expect(asMember).toEqual([])

    // An Owner sees their own, and only their own: this list is the settings
    // surface, not the Org's Project list.
    const asOwner = await asUser(fixture.acme.users.owner, listArchivalProjects)
    expect(asOwner.map((p) => p.key)).toEqual(['github.com/acme/private'])
  })

  test('names a Project once, however many Sessions ran in it', async () => {
    const project = await seedProject(
      fixture.acme,
      fixture.acme.members.member,
      'github.com/acme/api',
    )

    await sql`
      insert into turns (org_id, member_id, project_id, session_id, message_id, occurred_at)
      values (${fixture.acme.id}, ${fixture.acme.members.member}, ${project},
              'second-session', 'msg-second', now())
    `

    const projects = await asUser(
      fixture.acme.users.member,
      listArchivalProjects,
    )
    expect(projects).toHaveLength(1)
  })
})

describe('excluding a Project', () => {
  test('writes the exception, and re-including it writes the row back', async () => {
    const project = await seedProject(
      fixture.acme,
      fixture.acme.members.member,
      'github.com/acme/api',
    )

    const excluded = await asUser(fixture.acme.users.member, (tx) =>
      setProjectArchival(tx, fixture.acme.members.member, project, false),
    )
    expect(excluded).toBe(1)

    const [row] = await sql<{ archival_enabled: boolean; org_id: string }[]>`
      select archival_enabled, org_id from member_project_archival
       where member_id = ${fixture.acme.members.member}
         and project_id = ${project}
    `
    expect(row!.archival_enabled).toBe(false)
    // Taken from the `members` row, never from the caller.
    expect(row!.org_id).toBe(fixture.acme.id)

    const included = await asUser(fixture.acme.users.member, (tx) =>
      setProjectArchival(tx, fixture.acme.members.member, project, true),
    )
    expect(included).toBe(1)

    const after = await asUser(fixture.acme.users.member, listArchivalProjects)
    expect(after[0]!.archival_enabled).toBe(true)
  })

  test('is refused to every Role aiming at another Member settings', async () => {
    const project = await seedProject(
      fixture.acme,
      fixture.acme.members.member,
      'github.com/acme/api',
    )

    for (const role of ['owner', 'admin', 'manager'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- three Roles, order is clearer.
      await expect(
        asUser(fixture.acme.users[role], (tx) =>
          setProjectArchival(tx, fixture.acme.members.member, project, false),
        ),
      ).resolves.toBe(0)
    }

    const rows = await sql`select 1 from member_project_archival`
    expect(rows).toHaveLength(0)
  })

  test('cannot be overwritten by an Admin once the Member has set it', async () => {
    const project = await seedProject(
      fixture.acme,
      fixture.acme.members.member,
      'github.com/acme/api',
    )

    await asUser(fixture.acme.users.member, (tx) =>
      setProjectArchival(tx, fixture.acme.members.member, project, false),
    )

    // The update half of the same policy: an existing row is no easier to
    // reach than a new one.
    const changed = await asUser(
      fixture.acme.users.admin,
      (tx) =>
        tx`
        update member_project_archival set archival_enabled = true
         where member_id = ${fixture.acme.members.member}
           and project_id = ${project}
      `,
    )
    expect(changed.count).toBe(0)

    const [row] = await sql<{ archival_enabled: boolean }[]>`
      select archival_enabled from member_project_archival
       where project_id = ${project}
    `
    expect(row!.archival_enabled).toBe(false)
  })

  test('refuses a Project from another Org', async () => {
    const foreign = await seedProject(
      fixture.globex,
      fixture.globex.members.member,
      'github.com/globex/api',
    )

    // The `(org_id, project_id)` foreign key: the row names the Member's own
    // Org, so a Project from another one has nothing to point at.
    await expect(
      asUser(fixture.acme.users.member, (tx) =>
        setProjectArchival(tx, fixture.acme.members.member, foreign, false),
      ),
    ).rejects.toThrow(/member_project_archival_org_id_project_id_fkey/)
  })
})
