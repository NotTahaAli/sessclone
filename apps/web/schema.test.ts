import { readFileSync, readdirSync } from 'node:fs'

import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

// Tickets 21 and 22, checked against a real Postgres with the real migrations.
// A schema is the one thing a mock cannot stand in for: the unique index and
// the policies *are* the behaviour, and an ORM's opinion about them is not
// evidence. Ticket 25 owns turning this into a shared harness; until then it
// sits beside the other database test.
const sql = postgres(process.env.DATABASE_URL!)

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url)

// Every table these two migrations create, and nothing else: a table added
// without a policy is the failure ADR 0001 names, so the list is spelled out
// rather than discovered.
const ACCOUNT_TABLES = ['orgs', 'users', 'members', 'api_keys', 'member_scopes']
const COLLECTION_TABLES = [
  'devices',
  'projects',
  'turns',
  'session_events',
  'member_project_archival',
]

// The connection CI hands us is the cluster superuser, and a superuser is
// exempt from every policy. Applying the migrations under a plain role instead
// gives the tables an owner who is neither, which is the shape production has
// and the only shape in which `force row level security` is observable.
const OWNER = 'sessclone_rls_owner'

beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  if (!database.endsWith('_test')) {
    throw new Error(`refusing to reset ${database}: not a _test database`)
  }

  await sql.unsafe(`
    drop schema public cascade;
    create schema public;
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${OWNER}') then
        create role ${OWNER};
      end if;
    end $$;
    grant usage, create on schema public to ${OWNER};
  `)

  await sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${OWNER}`)
    for (const file of readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .toSorted()) {
      // oxlint-disable-next-line no-await-in-loop -- migrations apply in order.
      await tx.unsafe(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
    }
  })
})

afterAll(async () => {
  await sql.end()
})

describe('the migrations', () => {
  test('apply from empty, in order, and leave every table behind', async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
    `

    for (const name of [...ACCOUNT_TABLES, ...COLLECTION_TABLES]) {
      expect(tables.map((row) => row.table_name)).toContain(name)
    }
  })

  test('leave no table without row-level security', async () => {
    const unprotected = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `

    // The probe table from ticket 02 is the exception and is expected to be
    // deleted rather than protected — it holds a session id and nothing else.
    expect(unprotected.map((row) => row.relname)).toEqual(['probe_rows'])
  })

  test('force it, so the role that owns the tables is not exempt', async () => {
    // `enable` alone leaves a table's owner outside its own policies, which
    // makes the policies advisory: whether an Org's data is private comes down
    // to which role the dashboard happens to connect as (ADR 0007).
    const unforced = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relrowsecurity and not c.relforcerowsecurity
    `

    expect(unforced.map((row) => row.relname)).toEqual([])
  })

  test('ship each table with at least one policy, in the same migration', async () => {
    const policies = await sql<{ tablename: string; count: number }[]>`
      select tablename, count(*)::int as count from pg_policies
       where schemaname = 'public' group by tablename
    `
    const counted = new Map(
      policies.map((row) => [row.tablename, row.count] as const),
    )

    for (const name of [...ACCOUNT_TABLES, ...COLLECTION_TABLES]) {
      expect(counted.get(name) ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('the identity index', () => {
  const seed = async () => {
    const [org] = await sql<{ id: string }[]>`
      insert into orgs (name) values ('Acme') returning id
    `
    const [user] = await sql<{ id: string }[]>`
      insert into users (email) values ('a@example.com') returning id
    `
    const [member] = await sql<{ id: string }[]>`
      insert into members (org_id, user_id, role)
      values (${org!.id}, ${user!.id}, 'member') returning id
    `
    return { orgId: org!.id, memberId: member!.id }
  }

  const insertTurn = async (
    orgId: string,
    memberId: string,
    agentId: string | null,
    messageId = 'msg_1',
  ) => sql`
    insert into turns (org_id, member_id, session_id, agent_id, message_id, occurred_at, output_tokens)
    values (${orgId}, ${memberId}, 'session-1', ${agentId}, ${messageId}, now(), 10)
    on conflict do nothing
  `

  beforeAll(async () => {
    await sql`truncate turns, member_scopes, api_keys, members, users, orgs cascade`
  })

  test('stores a re-reported Turn once, without reading first', async () => {
    const { orgId, memberId } = await seed()

    await insertTurn(orgId, memberId, 'agent-1')
    await insertTurn(orgId, memberId, 'agent-1')

    expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 1 }])
  })

  test('dedups a main Session, whose agent id is null', async () => {
    // Without `nulls not distinct` the index would treat every re-report of a
    // main Session as a new row — which is every Turn a person starts.
    await sql`truncate turns cascade`
    const [member] = await sql<{ id: string; org_id: string }[]>`
      select id, org_id from members limit 1
    `

    await insertTurn(member!.org_id, member!.id, null)
    await insertTurn(member!.org_id, member!.id, null)

    expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 1 }])
  })

  test('keeps an Agent Run apart from the Session that spawned it', async () => {
    await sql`truncate turns cascade`
    const [member] = await sql<{ id: string; org_id: string }[]>`
      select id, org_id from members limit 1
    `

    await insertTurn(member!.org_id, member!.id, null)
    await insertTurn(member!.org_id, member!.id, 'agent-1')

    expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 2 }])
  })
})

describe('the policies, from a role that is not the owner', () => {
  // Postgres exempts a superuser and a table's owner from policies, so a plain
  // role is what makes them observable at all. On Supabase this is
  // `authenticated`; here it is a role created for the test.
  //
  // This is not the Seam C suite — ticket 44 owns the full matrix. It is the
  // set of attacks a fresh-eyes review actually landed against an earlier cut
  // of these migrations, each of which passed before the guards below existed.
  const ids = {
    acme: '11111111-1111-1111-1111-111111111111',
    beta: '22222222-2222-2222-2222-222222222222',
    member: 'aaaaaaaa-0000-0000-0000-000000000001',
    admin: 'aaaaaaaa-0000-0000-0000-000000000002',
    owner: 'aaaaaaaa-0000-0000-0000-000000000003',
    manager: 'aaaaaaaa-0000-0000-0000-000000000004',
    idle: 'aaaaaaaa-0000-0000-0000-000000000005',
    gone: 'aaaaaaaa-0000-0000-0000-000000000006',
    betaOwner: 'aaaaaaaa-0000-0000-0000-000000000007',
    memberRow: 'cccccccc-0000-0000-0000-000000000001',
    managerRow: 'cccccccc-0000-0000-0000-000000000004',
    goneRow: 'cccccccc-0000-0000-0000-000000000006',
    device: 'eeeeeeee-0000-0000-0000-000000000001',
  }

  const asUser = async <T>(
    userId: string,
    query: (tx: postgres.TransactionSql) => Promise<T>,
  ) =>
    sql.begin(async (tx) => {
      await tx`set local role sessclone_rls_probe`
      await tx.unsafe(
        `set local request.jwt.claims = '${JSON.stringify({ sub: userId })}'`,
      )
      return query(tx)
    })

  const sessionIds = async (userId: string) =>
    (
      await asUser(
        userId,
        (tx) => tx<{ session_id: string }[]>`select session_id from turns`,
      )
    ).map((row) => row.session_id)

  beforeAll(async () => {
    await sql.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'sessclone_rls_probe') then
          create role sessclone_rls_probe;
        end if;
      end $$;
      grant usage on schema public to sessclone_rls_probe;
      grant select, insert, update, delete on all tables in schema public to sessclone_rls_probe;
    `)
    await sql`truncate turns, member_project_archival, devices, projects, member_scopes, api_keys, members, users, orgs cascade`

    await sql`
      insert into orgs (id, name) values (${ids.acme}, 'Acme'), (${ids.beta}, 'Beta')
    `
    await sql`
      insert into users (id, email) values
        (${ids.member}, 'member@acme.test'),
        (${ids.admin}, 'admin@acme.test'),
        (${ids.owner}, 'owner@acme.test'),
        (${ids.manager}, 'manager@acme.test'),
        (${ids.idle}, 'idle-manager@acme.test'),
        (${ids.gone}, 'gone@acme.test'),
        (${ids.betaOwner}, 'owner@beta.test')
    `
    await sql`
      insert into members (id, org_id, user_id, role, removed_at) values
        (${ids.memberRow}, ${ids.acme}, ${ids.member}, 'member', null),
        ('cccccccc-0000-0000-0000-000000000002', ${ids.acme}, ${ids.admin}, 'admin', null),
        ('cccccccc-0000-0000-0000-000000000003', ${ids.acme}, ${ids.owner}, 'owner', null),
        (${ids.managerRow}, ${ids.acme}, ${ids.manager}, 'manager', null),
        ('cccccccc-0000-0000-0000-000000000005', ${ids.acme}, ${ids.idle}, 'manager', null),
        (${ids.goneRow}, ${ids.acme}, ${ids.gone}, 'member', now()),
        ('cccccccc-0000-0000-0000-000000000007', ${ids.beta}, ${ids.betaOwner}, 'owner', null)
    `
    await sql`
      insert into member_scopes (org_id, manager_member_id, member_id)
      values (${ids.acme}, ${ids.managerRow}, ${ids.memberRow})
    `
    await sql`
      insert into projects (id, org_id, key) values
        ('dddddddd-0000-0000-0000-000000000001', ${ids.acme}, 'github.com/acme/api'),
        ('dddddddd-0000-0000-0000-000000000002', ${ids.acme}, 'local:ownerbox:/home/owner/side-project'),
        ('dddddddd-0000-0000-0000-000000000003', ${ids.beta}, 'local:betabox:/home/beta/secret')
    `
    await sql`
      insert into devices (id, member_id, key)
      values (${ids.device}, ${ids.memberRow}, 'host:laptop')
    `
    await sql`
      insert into turns (org_id, member_id, session_id, message_id, occurred_at, project_id, output_tokens) values
        (${ids.acme}, ${ids.memberRow}, 'acme-member', 'm1', now(), 'dddddddd-0000-0000-0000-000000000001', 10),
        (${ids.acme}, 'cccccccc-0000-0000-0000-000000000003', 'acme-owner', 'm2', now(), 'dddddddd-0000-0000-0000-000000000002', 20),
        (${ids.beta}, 'cccccccc-0000-0000-0000-000000000007', 'beta-owner', 'm3', now(), 'dddddddd-0000-0000-0000-000000000003', 30)
    `
    await sql`
      insert into api_keys (id, member_id, label, key_hash, key_prefix, revoked_at)
      values ('ffffffff-0000-0000-0000-000000000001', ${ids.memberRow}, 'laptop', 'hash-1', 'sk_abcd', now())
    `
  })

  test('each Role reads exactly the Turns its Role grants', async () => {
    expect((await sessionIds(ids.owner)).toSorted()).toEqual([
      'acme-member',
      'acme-owner',
    ])
    expect((await sessionIds(ids.admin)).toSorted()).toEqual([
      'acme-member',
      'acme-owner',
    ])
    expect(await sessionIds(ids.manager)).toEqual(['acme-member'])
    expect(await sessionIds(ids.member)).toEqual(['acme-member'])
  })

  test('a Manager with an empty Scope reads nothing', async () => {
    expect(await sessionIds(ids.idle)).toEqual([])
  })

  test('a removed Member reads nothing, including their own history', async () => {
    expect(await sessionIds(ids.gone)).toEqual([])
  })

  test('a removed Member cannot reinstate themselves', async () => {
    // `members_read` deliberately has no "my own user id" branch, because
    // `members_write` would then let a removed Member clear their own
    // `removed_at` and walk back in.
    await asUser(
      ids.gone,
      (tx) =>
        tx`update members set removed_at = null where user_id = ${ids.gone}`,
    )

    const [row] = await sql<{ removed_at: Date | null }[]>`
      select removed_at from members where id = ${ids.goneRow}
    `
    expect(row?.removed_at).not.toBeNull()
  })

  test('nobody reads another Org, in either direction', async () => {
    expect(await sessionIds(ids.betaOwner)).toEqual(['beta-owner'])
    expect(await sessionIds(ids.owner)).not.toContain('beta-owner')
  })

  test('the role that owns the tables reads no more than a Member does', async () => {
    // The attack the rest of this suite could not see: every test above runs
    // as a role that owns nothing, so it proves the policies without proving
    // they apply to the connection an application actually makes.
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${OWNER}`)
      await tx.unsafe(
        `set local request.jwt.claims = '${JSON.stringify({ sub: ids.member })}'`,
      )
      return tx<{ session_id: string }[]>`select session_id from turns`
    })

    expect(rows.map((row) => row.session_id)).toEqual(['acme-member'])
  })

  test('a caller with no identity at all reads nothing', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`set local role sessclone_rls_probe`
      return tx`select session_id from turns`
    })

    expect(rows).toEqual([])
  })

  test('a Member cannot join an Org by rewriting their own row', async () => {
    // Landed as a working cross-Org read: `user_id = me` satisfies the update
    // policy, and nothing pinned the Org the row belongs to.
    await expect(
      asUser(
        ids.member,
        (tx) =>
          tx`update members set org_id = ${ids.beta} where user_id = ${ids.member}`,
      ),
    ).rejects.toThrow(/cannot change org or user/)
  })

  test('an Admin cannot graft a Member row into another Org', async () => {
    // The sharper form of the same hole: the victim's Turns change Org and
    // owner with them, which is story 49's history quietly rewritten.
    await expect(
      asUser(
        ids.admin,
        (tx) => tx`
          update members set org_id = ${ids.beta}, user_id = ${ids.admin}
           where id = ${ids.memberRow}
        `,
      ),
    ).rejects.toThrow(/cannot change org or user/)
  })

  test('an Admin cannot switch on archival for somebody they invite', async () => {
    // The update path was guarded; the invite was not, so an Admin could
    // create the row with the switch already on.
    await expect(
      asUser(
        ids.admin,
        (tx) => tx`
          insert into members (org_id, user_id, role, archival_enabled)
          values (${ids.acme}, ${ids.gone}, 'member', true)
        `,
      ),
    ).rejects.toThrow(/archival is the member's own switch/)
  })

  test('an Admin can still invite', async () => {
    const [row] = await asUser(
      ids.admin,
      (tx) => tx<{ id: string }[]>`
        insert into members (org_id, user_id, role)
        values (${ids.acme}, ${ids.betaOwner}, 'member')
        returning id
      `,
    )

    expect(row?.id).toBeTruthy()
    await sql`delete from members where id = ${row!.id}`
  })

  test('a Member cannot re-point or backdate their own Device', async () => {
    await expect(
      asUser(
        ids.member,
        (tx) =>
          tx`update devices set key = 'host:someone-else' where id = ${ids.device}`,
      ),
    ).rejects.toThrow(/only the nickname/)
  })

  test('a Member can still rename it', async () => {
    await asUser(
      ids.member,
      (tx) =>
        tx`update devices set nickname = 'work laptop' where id = ${ids.device}`,
    )

    const [row] = await sql<{ nickname: string }[]>`
      select nickname from devices where id = ${ids.device}
    `
    expect(row?.nickname).toBe('work laptop')
  })

  test('a Project key does not show an Org its Members machine layout', async () => {
    // A `local:` key is `local:<hostname>:<absolute path>`. Org-wide visibility
    // handed every Member the Owner's home directory, and showed a Manager
    // with an empty Scope something.
    const keys = async (userId: string) =>
      (
        await asUser(
          userId,
          (tx) => tx<{ key: string }[]>`select key from projects`,
        )
      ).map((row) => row.key)

    expect(await keys(ids.member)).toEqual(['github.com/acme/api'])
    expect(await keys(ids.idle)).toEqual([])
    expect((await keys(ids.owner)).toSorted()).toEqual([
      'github.com/acme/api',
      'local:ownerbox:/home/owner/side-project',
    ])
  })

  test('a revoked key cannot be brought back', async () => {
    await expect(
      asUser(
        ids.member,
        (tx) =>
          tx`update api_keys set revoked_at = null where id = 'ffffffff-0000-0000-0000-000000000001'`,
      ),
    ).rejects.toThrow(/cannot be un-revoked/)
  })

  test('nobody writes a Turn through a policy', async () => {
    await expect(
      asUser(
        ids.member,
        (tx) => tx`
          insert into turns (org_id, member_id, session_id, message_id, occurred_at)
          values (${ids.acme}, ${ids.memberRow}, 'forged', 'msg_forged', now())
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  test('and `turns` carries no update or delete policy to be granted one by', async () => {
    // The insert test above passes just as well with an update policy added,
    // which would break the append-only rule outright.
    const policies = await sql<{ cmd: string }[]>`
      select cmd from pg_policies where schemaname = 'public' and tablename = 'turns'
    `

    expect(policies.map((row) => row.cmd)).toEqual(['SELECT'])
  })

  test('a signed-in user can create an Org and own it', async () => {
    const created = await asUser(ids.betaOwner, async (tx) => {
      await tx`insert into orgs (id, name) values ('99999999-0000-0000-0000-000000000001', 'New Co')`
      await tx`
        insert into members (org_id, user_id, role)
        values ('99999999-0000-0000-0000-000000000001', ${ids.betaOwner}, 'owner')
      `
      return tx<{ name: string }[]>`select name from orgs order by name`
    })

    expect(created.map((row) => row.name)).toContain('New Co')
    await sql`delete from members where org_id = '99999999-0000-0000-0000-000000000001'`
    await sql`delete from orgs where id = '99999999-0000-0000-0000-000000000001'`
  })

  test('and cannot use that to walk into an Org that already has Members', async () => {
    await expect(
      asUser(
        ids.betaOwner,
        (tx) => tx`
          insert into members (org_id, user_id, role)
          values (${ids.acme}, ${ids.betaOwner}, 'owner')
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})

describe('constraints the policies cannot express', () => {
  test('a Turn cannot be filed under an Org its Member is not in', async () => {
    const [beta] = await sql<{ id: string }[]>`
      select id from members where org_id = '22222222-2222-2222-2222-222222222222' limit 1
    `

    await expect(
      sql`
        insert into turns (org_id, member_id, session_id, message_id, occurred_at)
        values ('11111111-1111-1111-1111-111111111111', ${beta!.id}, 's', 'm', now())
      `,
    ).rejects.toThrow(/turns_org_id_member_id_fkey/)
  })

  test('an empty agent id is refused, because the index cannot tell it from a real one', async () => {
    const [member] = await sql<{ id: string; org_id: string }[]>`
      select id, org_id from members where org_id = '11111111-1111-1111-1111-111111111111' limit 1
    `

    await expect(
      sql`
        insert into turns (org_id, member_id, session_id, agent_id, message_id, occurred_at)
        values (${member!.org_id}, ${member!.id}, 's', '', 'm', now())
      `,
    ).rejects.toThrow(/turns_agent_id_check/)
  })

  test('deleting an Org cannot be the thing that erases its spend history', async () => {
    await expect(
      sql`delete from orgs where id = '11111111-1111-1111-1111-111111111111'`,
    ).rejects.toThrow(/turns_org_id_fkey/)
  })
})
