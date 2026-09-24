import { beforeEach, describe, expect, test } from 'vitest'

import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
  type FixtureOrg,
  type FixtureRole,
} from './harness'

// Ticket 44, Seam C: the Role rules proved where ADR 0001 puts them — in the
// policies, on the connection the dashboard actually uses.
//
// Everything below reads through `asUser`/`asRole`, which is `sessclone_app`.
// The `owner` connection seeds and never asserts: it owns the tables, so
// Postgres applies no policy to it and a passing assertion there proves
// nothing (see the harness, and ticket 20's migration).
//
// **Adding a table later:** seed its rows in `seedRows` below, add a
// `describe` for it with a `reach` assertion naming what every viewer sees,
// and add its write guards as tests inside that same `describe`. A table with
// no block here is a table whose policies nothing checks.

/** Every viewer a `reach` assertion names: the six Roles, plus the two people outside every Org. */
type Viewer = FixtureRole | 'platformAdmin' | 'stranger'

/** How many rows each viewer can see in `table`, read as that viewer. */
type Reach = Record<Viewer, number>

const ROLES: FixtureRole[] = [
  'owner',
  'admin',
  'manager',
  'managerWithoutScope',
  'member',
  'removed',
]

let fixture: Fixture

const countAs = async (userId: string | null, table: string, where = 'true') =>
  (
    await asUser(userId, (tx) =>
      tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from ${table} where ${where}`,
      ),
    )
  )[0]!.n

/**
 * What every viewer sees in one table, as one object — so a broken policy
 * names the Role it broke for rather than failing a lone count.
 */
const reach = async (table: string, where = 'true'): Promise<Reach> => {
  const as = (viewer: Viewer) =>
    countAs(
      viewer === 'platformAdmin'
        ? fixture.platformAdmin.userId
        : viewer === 'stranger'
          ? fixture.stranger.userId
          : fixture.acme.users[viewer],
      table,
      where,
    )

  const [
    owner,
    admin,
    manager,
    managerWithoutScope,
    member,
    removed,
    platformAdmin,
    stranger,
  ] = await Promise.all([
    as('owner'),
    as('admin'),
    as('manager'),
    as('managerWithoutScope'),
    as('member'),
    as('removed'),
    as('platformAdmin'),
    as('stranger'),
  ])

  return {
    owner,
    admin,
    manager,
    managerWithoutScope,
    member,
    removed,
    platformAdmin,
    stranger,
  }
}

const hex = (seed: string) => seed.padEnd(64, '0').slice(0, 64).toLowerCase()

/**
 * The rows the fixture's people own, seeded through the `owner` connection —
 * which is how ingest writes (ADR 0001: `turns`, `session_events` and
 * `log_artifacts` carry no insert policy at all).
 *
 * One row per Role per table, so a count is a set of Roles: a Member's own
 * row is 1, a Manager's Scope is 2, an Org is 6.
 */
const seedRows = async (org: FixtureOrg) => {
  const slug = org.name.toLowerCase()

  const projectIds: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' }
  for (const key of ['a', 'b', 'c'] as const) {
    // oxlint-disable-next-line no-await-in-loop -- three rows, order is clearer.
    const [project] = await sql<{ id: string }[]>`
      insert into projects (org_id, key) values (${org.id}, ${`${slug}-${key}`})
      returning id
    `
    projectIds[key] = project!.id
  }

  for (const role of ROLES) {
    const memberId = org.members[role]
    const tag = `${slug}-${role}`
    // The Member's Turns sit on their own Project; everybody else shares a
    // second one — so "reads exactly their Scope" is visible on `projects`
    // too, and the third Project, which no Turn names, separates the Admin
    // branch of `sessclone_visible_project_ids` from the Turn branch.
    const projectId = role === 'member' ? projectIds.a : projectIds.b

    // oxlint-disable-next-line no-await-in-loop -- six Roles, order is clearer.
    const [device] = await sql<{ id: string }[]>`
      insert into devices (member_id, key) values (${memberId}, ${tag})
      returning id
    `

    // oxlint-disable-next-line no-await-in-loop -- six Roles, order is clearer.
    await sql`
      insert into turns
        (org_id, member_id, device_id, project_id, session_id, message_id, occurred_at)
      values
        (${org.id}, ${memberId}, ${device!.id}, ${projectId}, ${tag}, ${`msg-${tag}`}, now())
    `

    // oxlint-disable-next-line no-await-in-loop -- six Roles, order is clearer.
    await sql`
      insert into session_events
        (org_id, member_id, device_id, session_id, kind, occurred_at)
      values (${org.id}, ${memberId}, ${device!.id}, ${tag}, 'session_start', now())
    `

    // oxlint-disable-next-line no-await-in-loop -- six Roles, order is clearer.
    await sql`
      insert into log_artifacts
        (org_id, member_id, project_id, session_id, storage_key, sha256, size_bytes)
      values (
        ${org.id}, ${memberId}, ${projectId}, ${tag},
        ${`${slug}/${role}.jsonl`}, ${hex(String(ROLES.indexOf(role) + 1))}, 1024
      )
    `

    // oxlint-disable-next-line no-await-in-loop -- six Roles, order is clearer.
    await sql`
      insert into api_keys (member_id, label, key_hash, key_prefix)
      values (${memberId}, ${`${tag} laptop`}, ${`hash-${tag}`}, ${'sk_abcd'})
    `

    // oxlint-disable-next-line no-await-in-loop -- six Roles, order is clearer.
    await sql`
      insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
      values (${org.id}, ${memberId}, ${projectId}, true)
    `
  }

  await sql`
    insert into org_rate_overrides (org_id, class, price_usd, effective_from)
    values (${org.id}, 'input', 1.5, '2026-01-01')
  `

  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name) values (${`${slug}-tier`}, ${org.name})
    returning id
  `

  // Writes a `subscription_events` row through the trigger, which is that
  // table's only author.
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${org.id}, ${tier!.id}, 'active')
  `

  return { projectIds }
}

let acmeProjects: Record<'a' | 'b' | 'c', string>

beforeEach(async () => {
  fixture = await seedFixture()
  acmeProjects = (await seedRows(fixture.acme)).projectIds
  // Globex exists so every cross-Org assertion below is about rows that are
  // really there. A zero-row read over an empty table proves nothing.
  await seedRows(fixture.globex)

  await sql`
    insert into rates (model, class, price_usd, effective_from)
    values ('claude-opus-5', 'input', 15, '2026-01-01'),
           (null, 'web_search_request', 10, '2026-01-01')
  `
})

/**
 * Every table carrying an `org_id`, for the cross-Org sweep. `devices` has
 * none — it is keyed to a Member — so it is covered by its own test below.
 */
const ORG_TABLES = [
  'members',
  'projects',
  'turns',
  'session_events',
  'log_artifacts',
  'member_project_archival',
  'org_rate_overrides',
  'subscriptions',
  'subscription_events',
]

describe('orgs', () => {
  test('is visible to its own Members and to the platform admin', async () => {
    expect(await reach('orgs')).toEqual({
      owner: 1,
      admin: 1,
      manager: 1,
      managerWithoutScope: 1,
      member: 1,
      // A removed Member belongs to no Org: `sessclone_org_ids` filters on
      // `removed_at is null`.
      removed: 0,
      // Both Orgs — the flag is outside every Org, which is why it is a flag.
      platformAdmin: 2,
      stranger: 0,
    })
  })

  test('is renamed by an Owner or an Admin and by nobody else', async () => {
    const rename = (role: FixtureRole | 'platformAdmin') =>
      asUser(
        role === 'platformAdmin'
          ? fixture.platformAdmin.userId
          : fixture.acme.users[role],
        (tx) =>
          tx`update orgs set name = ${`${role} was here`} where id = ${fixture.acme.id}`,
      )

    expect((await rename('owner')).count).toBe(1)
    expect((await rename('admin')).count).toBe(1)
    expect((await rename('manager')).count).toBe(0)
    expect((await rename('member')).count).toBe(0)
    // A platform admin is not an Org Role: `orgs_write` reads
    // `sessclone_admin_org_ids`, which has no flag branch.
    expect((await rename('platformAdmin')).count).toBe(0)
  })
})

describe('users', () => {
  test('is visible exactly as far as the Members the viewer may see', async () => {
    expect(await reach('users')).toEqual({
      owner: 6,
      admin: 6,
      manager: 2,
      managerWithoutScope: 1,
      member: 1,
      // Themselves, and nothing else: `sessclone_visible_user_ids` always
      // returns the caller. Their membership row stays invisible.
      removed: 1,
      // Twelve Org users, the operator, the stranger.
      platformAdmin: 14,
      stranger: 1,
    })
  })

  test('is edited only by the person it is', async () => {
    const { count } = await asRole(
      fixture.acme,
      'member',
      (tx) =>
        tx`update users set email = 'stolen@acme.test' where id = ${fixture.acme.users.owner}`,
    )

    expect(count).toBe(0)
  })

  test('refuses anybody handing themselves the deployment', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) =>
          tx`update users set is_platform_admin = true where id = ${fixture.acme.users.owner}`,
      ),
    ).rejects.toThrow(/only a platform admin may change is_platform_admin/)
  })
})

describe('members', () => {
  test('is visible to the Roles above it and to nobody below', async () => {
    expect(await reach('members')).toEqual({
      owner: 6,
      admin: 6,
      // Themselves and their one scoped Member.
      manager: 2,
      // An empty Scope sees nobody but themselves.
      managerWithoutScope: 1,
      member: 1,
      // Not even their own row: `members_read` has no self branch, so they
      // cannot see the `removed_at` they would otherwise clear.
      removed: 0,
      platformAdmin: 12,
      stranger: 0,
    })
  })

  test('refuses a Member changing their own Role', async () => {
    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) =>
          tx`update members set role = 'owner' where id = ${fixture.acme.members.member}`,
      ),
    ).rejects.toThrow(/only an owner or admin may change a role/)
  })

  test('lets an Admin change a Role', async () => {
    const { count } = await asRole(
      fixture.acme,
      'admin',
      (tx) =>
        tx`update members set role = 'manager' where id = ${fixture.acme.members.member}`,
    )

    expect(count).toBe(1)
  })

  test('pins the Org and the user a row belongs to', async () => {
    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) =>
          tx`update members set org_id = ${fixture.globex.id} where id = ${fixture.acme.members.member}`,
      ),
    ).rejects.toThrow(/a member row cannot change org or user/)

    await expect(
      asRole(
        fixture.acme,
        'admin',
        (tx) =>
          tx`update members set user_id = ${fixture.stranger.userId} where id = ${fixture.acme.members.member}`,
      ),
    ).rejects.toThrow(/a member row cannot change org or user/)
  })

  test('keeps archival as the Member own switch, on update and on invite', async () => {
    const mine = await asRole(
      fixture.acme,
      'member',
      (tx) =>
        tx`update members set archival_enabled = true where id = ${fixture.acme.members.member}`,
    )
    expect(mine.count).toBe(1)

    await expect(
      asRole(
        fixture.acme,
        'admin',
        (tx) =>
          tx`update members set archival_enabled = true where id = ${fixture.acme.members.manager}`,
      ),
    ).rejects.toThrow(/archival is the member's own switch/)

    const [invitee] = await sql<{ id: string }[]>`
      insert into users (email) values ('invitee@acme.test') returning id
    `
    await expect(
      asRole(
        fixture.acme,
        'admin',
        (tx) => tx`
          insert into members (org_id, user_id, archival_enabled)
          values (${fixture.acme.id}, ${invitee!.id}, true)
        `,
      ),
    ).rejects.toThrow(/archival is the member's own switch/)
  })

  test('refuses an invite into an Org the inviter does not administer', async () => {
    const [invitee] = await sql<{ id: string }[]>`
      insert into users (email) values ('invitee@globex.test') returning id
    `

    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into members (org_id, user_id)
          values (${fixture.globex.id}, ${invitee!.id})
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`
          insert into members (org_id, user_id)
          values (${fixture.acme.id}, ${invitee!.id})
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  test('refuses a removed Member re-admitting themselves', async () => {
    // `members_read` hides the row, which is what the migration's comment
    // rests on — but an UPDATE with no WHERE clause reads no column, so only
    // `members_write`'s USING clause filters it, and that clause is
    // `user_id = sessclone_user_id()` with no `removed_at` test.
    await asRole(
      fixture.acme,
      'removed',
      (tx) => tx`update members set removed_at = null`,
    )

    const [row] = await sql<{ removed_at: Date | null }[]>`
      select removed_at from members where id = ${fixture.acme.members.removed}
    `

    expect(row!.removed_at).not.toBeNull()
  })
})

describe('api_keys', () => {
  test('is personal, and not an Admin business', async () => {
    expect(await reach('api_keys')).toEqual({
      owner: 1,
      admin: 1,
      manager: 1,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      // No flag branch on `api_keys_own`, and none is wanted: a key is
      // personal even to the operator.
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('refuses a key issued against somebody else', async () => {
    await expect(
      asRole(
        fixture.acme,
        'admin',
        (tx) => tx`
          insert into api_keys (member_id, label, key_hash, key_prefix)
          values (${fixture.acme.members.member}, 'planted', 'hash-planted', 'sk_plnt')
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  test('keeps a revoked key revoked', async () => {
    const [key] = await sql<{ id: string }[]>`
      insert into api_keys (member_id, label, key_hash, key_prefix, revoked_at)
      values (${fixture.acme.members.member}, 'lost laptop', 'hash-lost', 'sk_lost', now())
      returning id
    `

    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`update api_keys set revoked_at = null where id = ${key!.id}`,
      ),
    ).rejects.toThrow(/a revoked key cannot be un-revoked/)
  })
})

describe('member_scopes', () => {
  test('is visible to the Org Admins and to the Manager it scopes', async () => {
    expect(await reach('member_scopes')).toEqual({
      owner: 1,
      admin: 1,
      manager: 1,
      managerWithoutScope: 0,
      member: 0,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('is assigned and revoked only by an Owner or an Admin', async () => {
    await expect(
      asRole(
        fixture.acme,
        'managerWithoutScope',
        (tx) => tx`
          insert into member_scopes (org_id, manager_member_id, member_id)
          values (
            ${fixture.acme.id},
            ${fixture.acme.members.managerWithoutScope},
            ${fixture.acme.members.member}
          )
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    const revoked = await asRole(
      fixture.acme,
      'manager',
      (tx) =>
        tx`delete from member_scopes where manager_member_id = ${fixture.acme.members.manager}`,
    )
    expect(revoked.count).toBe(0)

    const assigned = await asRole(
      fixture.acme,
      'admin',
      (tx) => tx`
        insert into member_scopes (org_id, manager_member_id, member_id)
        values (
          ${fixture.acme.id},
          ${fixture.acme.members.managerWithoutScope},
          ${fixture.acme.members.member}
        )
      `,
    )
    expect(assigned.count).toBe(1)
  })
})

describe('devices', () => {
  test('is visible exactly as far as the Members the viewer may see', async () => {
    expect(await reach('devices')).toEqual({
      owner: 6,
      admin: 6,
      manager: 2,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('is renamed by its own Member and by nobody else', async () => {
    const [mine] = await sql<{ id: string }[]>`
      select id from devices where member_id = ${fixture.acme.members.member}
    `

    const own = await asRole(
      fixture.acme,
      'member',
      (tx) => tx`update devices set nickname = 'laptop' where id = ${mine!.id}`,
    )
    expect(own.count).toBe(1)

    // A Manager may read the Device and may not touch it: `devices_rename`
    // resolves through `sessclone_own_member_ids`, not the visible set.
    const theirs = await asRole(
      fixture.acme,
      'manager',
      (tx) => tx`update devices set nickname = 'theirs' where id = ${mine!.id}`,
    )
    expect(theirs.count).toBe(0)
  })

  test('refuses a rename that re-points or backdates the Device', async () => {
    const [mine] = await sql<{ id: string }[]>`
      select id from devices where member_id = ${fixture.acme.members.member}
    `

    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) =>
          tx`update devices set key = 'somebody-else' where id = ${mine!.id}`,
      ),
    ).rejects.toThrow(/only the nickname is the member's to change/)

    // The migration says the two timestamps are the row's only provenance and
    // that a rename must not backdate it. `sessclone_guard_device_columns`
    // pins `first_seen_at` and leaves `last_seen_at` out, so the Member can
    // move it.
    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) =>
          tx`update devices set last_seen_at = '2020-01-01' where id = ${mine!.id}`,
      ),
    ).rejects.toThrow(/only the nickname is the member's to change/)
  })
})

describe('projects', () => {
  test('is visible through the Org for an Admin and through Turns for everybody else', async () => {
    expect(await reach('projects')).toEqual({
      // All three, including the one no Turn names.
      owner: 3,
      admin: 3,
      // Their own Turns' Project and their scoped Member's.
      manager: 2,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('shows a Member no Project they have no Turn on', async () => {
    expect(
      await countAs(
        fixture.acme.users.member,
        'projects',
        `id = '${acmeProjects.c}'`,
      ),
    ).toBe(0)
  })

  test('is not writable through the dashboard at all', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) =>
          tx`insert into projects (org_id, key) values (${fixture.acme.id}, 'mine')`,
      ),
    ).rejects.toThrow(/permission denied for table projects/)
  })
})

describe('turns', () => {
  test('is read by a Member for themselves, by a Manager for their Scope, by an Admin for the Org', async () => {
    expect(await reach('turns')).toEqual({
      owner: 6,
      admin: 6,
      manager: 2,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('is append-only: nothing the browser reaches may write one', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into turns (org_id, member_id, session_id, message_id, occurred_at)
          values (${fixture.acme.id}, ${fixture.acme.members.owner}, 's', 'm', now())
        `,
      ),
    ).rejects.toThrow(/permission denied for table turns/)

    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`update turns set output_tokens = 0`,
      ),
    ).rejects.toThrow(/permission denied for table turns/)

    await expect(
      asRole(fixture.acme, 'owner', (tx) => tx`delete from turns`),
    ).rejects.toThrow(/permission denied for table turns/)
  })
})

describe('session_events', () => {
  test('is visible exactly as far as the Turns beside it', async () => {
    expect(await reach('session_events')).toEqual({
      owner: 6,
      admin: 6,
      manager: 2,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('is written by ingest alone', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into session_events (org_id, member_id, session_id, kind, occurred_at)
          values (${fixture.acme.id}, ${fixture.acme.members.owner}, 's', 'session_end', now())
        `,
      ),
    ).rejects.toThrow(/permission denied for table session_events/)
  })
})

describe('member_project_archival', () => {
  test('is the Member own list, which an Admin does not read', async () => {
    expect(await reach('member_project_archival')).toEqual({
      owner: 1,
      admin: 1,
      manager: 1,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('refuses an exception written against somebody else', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
          values (
            ${fixture.acme.id}, ${fixture.acme.members.member},
            ${acmeProjects.c}, false
          )
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    const own = await asRole(
      fixture.acme,
      'member',
      (tx) => tx`
        insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
        values (
          ${fixture.acme.id}, ${fixture.acme.members.member},
          ${acmeProjects.c}, false
        )
      `,
    )
    expect(own.count).toBe(1)
  })

  test('refuses that write to every other Role, and across Orgs', async () => {
    // The Owner case above, completed: ticket 72's settings surface claims no
    // Role can write another Member's exceptions, and a claim about a matrix
    // wants the matrix.
    for (const role of ['admin', 'manager', 'managerWithoutScope'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- three Roles, order is clearer.
      await expect(
        asRole(
          fixture.acme,
          role,
          (tx) => tx`
            insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
            values (
              ${fixture.acme.id}, ${fixture.acme.members.member},
              ${acmeProjects.c}, false
            )
          `,
        ),
      ).rejects.toThrow(/row-level security/)
    }

    // Another Org's Owner, at a row that names neither their Org nor their
    // Member: refused by the same policy, not by the foreign keys.
    await expect(
      asRole(
        fixture.globex,
        'owner',
        (tx) => tx`
          insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
          values (
            ${fixture.acme.id}, ${fixture.acme.members.member},
            ${acmeProjects.c}, false
          )
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    // And the update half, aimed at a row the Member already owns.
    await asRole(
      fixture.acme,
      'member',
      (tx) => tx`
        insert into member_project_archival (org_id, member_id, project_id, archival_enabled)
        values (
          ${fixture.acme.id}, ${fixture.acme.members.member},
          ${acmeProjects.c}, false
        )
      `,
    )

    const changed = await asRole(
      fixture.acme,
      'manager',
      (tx) => tx`
        update member_project_archival set archival_enabled = true
         where member_id = ${fixture.acme.members.member}
           and project_id = ${acmeProjects.c}
      `,
    )
    expect(changed.count).toBe(0)
  })
})

describe('rates', () => {
  test('is the price list, readable by anybody signed in and nobody else', async () => {
    expect(await reach('rates')).toEqual({
      owner: 2,
      admin: 2,
      manager: 2,
      managerWithoutScope: 2,
      member: 2,
      // Signed in, in no Org. Every Cost is a join against this table.
      removed: 2,
      platformAdmin: 2,
      stranger: 2,
    })

    expect(await countAs(null, 'rates')).toBe(0)
  })

  test('is written by the operator and by no Org Owner', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into rates (model, class, price_usd, effective_from)
          values ('claude-opus-5', 'output', 0, '2026-01-01')
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    const cut = await asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update rates set price_usd = 0`,
    )
    expect(cut.count).toBe(0)

    const written = await asUser(
      fixture.platformAdmin.userId,
      (tx) => tx`
        insert into rates (model, class, price_usd, effective_from)
        values ('claude-opus-5', 'output', 75, '2026-01-01')
      `,
    )
    expect(written.count).toBe(1)
  })
})

describe('org_rate_overrides', () => {
  test('is visible inside its own Org and to the operator', async () => {
    expect(await reach('org_rate_overrides')).toEqual({
      owner: 1,
      admin: 1,
      // Every Member sees what explains their own numbers.
      manager: 1,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 2,
      stranger: 0,
    })
  })

  test('is negotiated with the operator, not set by the customer', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into org_rate_overrides (org_id, class, price_usd, effective_from)
          values (${fixture.acme.id}, 'output', 0, '2026-01-01')
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    const halved = await asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update org_rate_overrides set price_usd = 0`,
    )
    expect(halved.count).toBe(0)
  })
})

describe('tiers', () => {
  test('is the pricing page, readable without a session at all', async () => {
    expect(await reach('tiers')).toEqual({
      owner: 2,
      admin: 2,
      manager: 2,
      managerWithoutScope: 2,
      member: 2,
      removed: 2,
      platformAdmin: 2,
      stranger: 2,
    })

    expect(await countAs(null, 'tiers')).toBe(2)
  })

  test('is edited by the operator alone', async () => {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) =>
          tx`insert into tiers (key, name) values ('free-for-me', 'Free')`,
      ),
    ).rejects.toThrow(/row-level security/)

    const written = await asUser(
      fixture.platformAdmin.userId,
      (tx) =>
        tx`insert into tiers (key, name) values ('enterprise', 'Enterprise')`,
    )
    expect(written.count).toBe(1)
  })
})

describe('subscriptions', () => {
  test('is visible to everybody in the Org, because the Tier explains their limits', async () => {
    expect(await reach('subscriptions')).toEqual({
      owner: 1,
      admin: 1,
      manager: 1,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 2,
      stranger: 0,
    })
  })

  test('is activated by the operator and never by the Owner', async () => {
    const [tier] = await sql<{ id: string }[]>`select id from tiers limit 1`

    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
          insert into subscriptions (org_id, tier_id, status)
          values (${fixture.globex.id}, ${tier!.id}, 'active')
        `,
      ),
    ).rejects.toThrow(/row-level security/)

    const activated = await asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update subscriptions set status = 'active'`,
    )
    expect(activated.count).toBe(0)

    const operator = await asUser(
      fixture.platformAdmin.userId,
      (tx) =>
        tx`update subscriptions set status = 'past_due' where org_id = ${fixture.acme.id}`,
    )
    expect(operator.count).toBe(1)
  })

  test('cannot be moved to another Org', async () => {
    await expect(
      asUser(
        fixture.platformAdmin.userId,
        (tx) =>
          tx`update subscriptions set org_id = ${fixture.globex.id} where org_id = ${fixture.acme.id}`,
      ),
    ).rejects.toThrow(/a subscription cannot change org/)
  })
})

describe('subscription_events', () => {
  test('is the Org audit trail, visible to the Org and the operator', async () => {
    expect(await reach('subscription_events')).toEqual({
      owner: 1,
      admin: 1,
      manager: 1,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 2,
      stranger: 0,
    })
  })

  test('has exactly one author, and it is not a person', async () => {
    const [event] = await sql<{ id: string }[]>`
      select id from subscription_events where org_id = ${fixture.acme.id}
    `

    await expect(
      asUser(
        fixture.platformAdmin.userId,
        (tx) => tx`
          insert into subscription_events (subscription_id, org_id, status, tier_id, provider)
          select id, org_id, 'active', tier_id, 'manual' from subscriptions limit 1
        `,
      ),
    ).rejects.toThrow(/permission denied for table subscription_events/)

    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`delete from subscription_events where id = ${event!.id}`,
      ),
    ).rejects.toThrow(/permission denied for table subscription_events/)
  })
})

describe('log_artifacts', () => {
  test('is downloadable exactly as far as the Members the viewer may see', async () => {
    expect(await reach('log_artifacts')).toEqual({
      owner: 6,
      admin: 6,
      manager: 2,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('is destroyed by its own Member and by nobody above them', async () => {
    const theirs = await asRole(
      fixture.acme,
      'admin',
      (tx) =>
        tx`delete from log_artifacts where member_id = ${fixture.acme.members.member}`,
    )
    // An Admin may download the transcript and may not destroy it.
    expect(theirs.count).toBe(0)

    const scoped = await asRole(
      fixture.acme,
      'manager',
      (tx) =>
        tx`delete from log_artifacts where member_id = ${fixture.acme.members.member}`,
    )
    expect(scoped.count).toBe(0)

    const own = await asRole(
      fixture.acme,
      'member',
      (tx) =>
        tx`delete from log_artifacts where member_id = ${fixture.acme.members.member}`,
    )
    expect(own.count).toBe(1)
  })

  test('is claimed by ingest alone', async () => {
    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`
          insert into log_artifacts
            (org_id, member_id, session_id, storage_key, sha256, size_bytes)
          values (
            ${fixture.acme.id}, ${fixture.acme.members.member}, 'forged',
            'acme/forged.jsonl', ${hex('b')}, 1
          )
        `,
      ),
    ).rejects.toThrow(/permission denied for table log_artifacts/)
  })
})

describe('log_artifact_chunks', () => {
  // ADR 0008: a chunk is part of its transcript, so it is read and destroyed
  // by exactly who may read and destroy the transcript.
  //
  // Seeded here rather than in `seedRows`: a chunk makes its transcript
  // undeletable on its own (the `no action` key below), which is the point,
  // and would turn every other test's plain artifact delete into a 23503.
  // One chunk per transcript, so a count is a set of Roles as above.
  beforeEach(async () => {
    await sql`
      update log_artifacts
         set sealed_bytes = 1024, sealed_sha256 = ${hex('c')}
    `
    await sql`
      insert into log_artifact_chunks
        (artifact_id, member_id, seq, raw_offset, raw_length, stored_bytes,
         sha256, storage_key)
      select id, member_id, 1, 0, 1024, 300, ${hex('c')},
             storage_key || '.chunks/000001.jsonl.gz'
        from log_artifacts
    `
  })

  test('is readable exactly as far as the transcript it belongs to', async () => {
    expect(await reach('log_artifact_chunks')).toEqual({
      owner: 6,
      admin: 6,
      manager: 2,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('is destroyed by its own Member and by nobody above them', async () => {
    const theirs = fixture.acme.members.member
    for (const role of ['owner', 'admin', 'manager'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one Role at a time reads clearly on failure.
      const refused = await asRole(
        fixture.acme,
        role,
        (tx) => tx`delete from log_artifact_chunks where member_id = ${theirs}`,
      )
      expect(refused.count, role).toBe(0)
    }

    const own = await asRole(
      fixture.acme,
      'member',
      (tx) => tx`delete from log_artifact_chunks where member_id = ${theirs}`,
    )
    expect(own.count).toBe(1)
  })

  test('is written by the confirm route alone', async () => {
    const [artifact] = await sql<{ id: string }[]>`
      select id from log_artifacts where member_id = ${fixture.acme.members.member}
    `
    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`
          insert into log_artifact_chunks
            (artifact_id, member_id, seq, raw_offset, raw_length, stored_bytes,
             sha256, storage_key)
          values (${artifact!.id}, ${fixture.acme.members.member}, 2, 1024, 1,
                  1, ${hex('d')}, 'acme/forged.jsonl.gz')
        `,
      ),
    ).rejects.toThrow(/permission denied for table log_artifact_chunks/)

    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`update log_artifact_chunks set stored_bytes = 0`,
      ),
    ).rejects.toThrow(/permission denied for table log_artifact_chunks/)
  })

  test('outlives no transcript: deleting one that still has chunks fails', async () => {
    const theirs = fixture.acme.members.member
    // `no action`, not `cascade`: a cascade would drop the only record of the
    // chunk objects' keys and leave source code in the bucket.
    await expect(
      sql`delete from log_artifacts where member_id = ${theirs}`,
    ).rejects.toMatchObject({ code: '23503' })

    // The delete paths take both in one statement and gather every key.
    const keys = await sql<{ storage_key: string }[]>`
      with doomed as (
        select id from log_artifacts where member_id = ${theirs}
      ), chunks as (
        delete from log_artifact_chunks
         where artifact_id in (select id from doomed)
        returning storage_key
      ), artifacts as (
        delete from log_artifacts where id in (select id from doomed)
        returning storage_key
      )
      select storage_key from chunks
      union all select storage_key from artifacts
    `
    expect(keys.map((row) => row.storage_key).toSorted()).toEqual([
      'acme/member.jsonl',
      'acme/member.jsonl.chunks/000001.jsonl.gz',
    ])
  })

  test('names the same Member as the transcript it belongs to', async () => {
    const [artifact] = await sql<{ id: string }[]>`
      select id from log_artifacts where member_id = ${fixture.acme.members.member}
    `
    // `member_id` is denormalised for the policies, so it must not be able to
    // disagree with the artifact's: a chunk filed under the Admin would be
    // deletable by the wrong person.
    await expect(sql`
      insert into log_artifact_chunks
        (artifact_id, member_id, seq, raw_offset, raw_length, stored_bytes,
         sha256, storage_key)
      values (${artifact!.id}, ${fixture.acme.members.admin}, 2, 1024, 1, 1,
              ${hex('d')}, 'acme/mismatch.jsonl.gz')
    `).rejects.toMatchObject({ code: '23503' })
  })
})

describe('log_upload_pending', () => {
  // ADR 0008: the keys a presign signed and no confirm has recorded yet. A
  // Member's own delete takes them with their transcript; nobody else reads
  // or removes them, and nothing the browser reaches writes them.
  beforeEach(async () => {
    await sql`
      insert into log_upload_pending
        (storage_key, member_id, session_id, kind, expires_at)
      select storage_key || '.pending', member_id, session_id, 'transcript',
             now() + interval '1 hour'
        from log_artifacts where org_id = ${fixture.acme.id}
    `
  })

  test('is read by its own Member alone', async () => {
    expect(await reach('log_upload_pending')).toEqual({
      owner: 1,
      admin: 1,
      manager: 1,
      managerWithoutScope: 1,
      member: 1,
      removed: 0,
      platformAdmin: 0,
      stranger: 0,
    })
  })

  test('is deleted by its own Member and by nobody above them', async () => {
    const theirs = fixture.acme.members.member
    for (const role of ['owner', 'admin', 'manager'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one Role at a time reads clearly on failure.
      const refused = await asRole(
        fixture.acme,
        role,
        (tx) => tx`delete from log_upload_pending where member_id = ${theirs}`,
      )
      expect(refused.count, role).toBe(0)
    }

    const own = await asRole(
      fixture.acme,
      'member',
      (tx) => tx`delete from log_upload_pending where member_id = ${theirs}`,
    )
    expect(own.count).toBe(1)
  })

  test('is written by the presign route alone', async () => {
    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`
          insert into log_upload_pending
            (storage_key, member_id, session_id, kind, expires_at)
          values ('acme/forged', ${fixture.acme.members.member}, 's',
                  'transcript', now())
        `,
      ),
    ).rejects.toThrow(/permission denied for table log_upload_pending/)

    await expect(
      asRole(
        fixture.acme,
        'member',
        (tx) => tx`update log_upload_pending set expires_at = now()`,
      ),
    ).rejects.toThrow(/permission denied for table log_upload_pending/)
  })
})

describe('across Orgs', () => {
  test('no Role reads a row of the other Org, on any table that has one', async () => {
    // Globex holds the same rows Acme does, seeded the same way, so each zero
    // below is a refusal rather than an empty table.
    for (const table of ORG_TABLES) {
      // oxlint-disable-next-line no-await-in-loop -- one table at a time reads clearly on failure.
      const seen = await Promise.all(
        ROLES.map(async (role) => [
          `${table}/${role}`,
          await countAs(
            fixture.acme.users[role],
            table,
            `org_id = '${fixture.globex.id}'`,
          ),
        ]),
      )

      expect(Object.fromEntries(seen)).toEqual(
        Object.fromEntries(ROLES.map((role) => [`${table}/${role}`, 0])),
      )
    }
  })

  test('the other Org really has those rows', async () => {
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from turns where org_id = ${fixture.globex.id}
    `
    expect(row!.n).toBe(6)
  })

  test('a Member of one Org cannot reach the other through a Device or a Project', async () => {
    const [device] = await sql<{ id: string }[]>`
      select id from devices where member_id = ${fixture.globex.members.member}
    `

    expect(
      await countAs(
        fixture.acme.users.owner,
        'devices',
        `id = '${device!.id}'`,
      ),
    ).toBe(0)

    const renamed = await asRole(
      fixture.acme,
      'owner',
      (tx) =>
        tx`update devices set nickname = 'mine now' where id = ${device!.id}`,
    )
    expect(renamed.count).toBe(0)
  })
})

describe('the people outside every Org', () => {
  test('a stranger reads nothing but the price list and their own user row', async () => {
    const tables = [
      'orgs',
      'members',
      'api_keys',
      'member_scopes',
      'devices',
      'projects',
      'turns',
      'session_events',
      'member_project_archival',
      'org_rate_overrides',
      'subscriptions',
      'subscription_events',
      'log_artifacts',
    ]

    const seen = await Promise.all(
      tables.map(async (table) => [
        table,
        await countAs(fixture.stranger.userId, table),
      ]),
    )

    expect(Object.fromEntries(seen)).toEqual(
      Object.fromEntries(tables.map((table) => [table, 0])),
    )
  })

  test('a platform admin operates the deployment without being in an Org', async () => {
    // What the flag reaches: accounts, and the money. Not one Turn, not one
    // transcript, not one API key.
    const seen = await Promise.all(
      [
        'turns',
        'session_events',
        'log_artifacts',
        'devices',
        'projects',
        'api_keys',
        'member_scopes',
        'member_project_archival',
      ].map(async (table) => [
        table,
        await countAs(fixture.platformAdmin.userId, table),
      ]),
    )

    expect(Object.fromEntries(seen)).toEqual({
      turns: 0,
      session_events: 0,
      log_artifacts: 0,
      devices: 0,
      projects: 0,
      api_keys: 0,
      member_scopes: 0,
      member_project_archival: 0,
    })
  })
})

/** `sessclone_is_platform_admin()`, read as somebody, on the app's own role. */
const isAdmin = async (userId: string | null) =>
  (
    await asUser(
      userId,
      (tx) =>
        tx<{ admin: boolean }[]>`select sessclone_is_platform_admin() as admin`,
    )
  )[0]!.admin

describe('the platform gate', () => {
  // Ticket 62's refusal, proved where ADR 0001 puts it. The admin area's
  // routing asks `sessclone_is_platform_admin()` and so does every policy on
  // the deployment's own tables, so this is the one assertion that covers
  // both: it is the same function, read on the connection the dashboard uses.
  test('no Org Role grants it, however senior', async () => {
    for (const role of ROLES) {
      // oxlint-disable-next-line no-await-in-loop -- six reads, order is clearer.
      expect([role, await isAdmin(fixture.acme.users[role])]).toEqual([
        role,
        false,
      ])
    }
  })

  test('the flag grants it, and being signed out does not', async () => {
    expect(await isAdmin(fixture.platformAdmin.userId)).toBe(true)
    expect(await isAdmin(fixture.stranger.userId)).toBe(false)
    // Nobody signed in at all. The claim is unset, `sessclone_user_id()` is
    // null, and the function must say no rather than match a null id against a
    // row that happens to have one.
    expect(await isAdmin(null)).toBe(false)
  })

  test('an Owner cannot hand it to themselves, or to anybody else', async () => {
    // `users_write_self` lets a person write their own row, so the refusal has
    // to come from the column guard rather than from the policy.
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) =>
          tx`update users set is_platform_admin = true where id = ${fixture.acme.users.owner}`,
      ),
    ).rejects.toThrow(/only a platform admin may change is_platform_admin/)

    // And a row they cannot write at all is refused by the policy first: no
    // rows touched, no error.
    expect(
      (
        await asRole(
          fixture.acme,
          'owner',
          (tx) =>
            tx`update users set is_platform_admin = true where id = ${fixture.acme.users.admin}`,
        )
      ).count,
    ).toBe(0)

    expect(await isAdmin(fixture.acme.users.owner)).toBe(false)
  })
})
