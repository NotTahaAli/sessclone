import { describe, expect, test, beforeEach } from 'vitest'

import postgres from 'postgres'

import { asUser, owner as sql } from './harness'

// Tickets 21 and 22, checked against a real Postgres with the real migrations.
// A schema is the one thing a mock cannot stand in for: the unique index and
// the policies *are* the behaviour, and an ORM's opinion about them is not
// evidence.
//
// The rig is ticket 25's: `test/harness.ts` applies the migrations once per
// run and truncates between tests, and `asUser` reads as `sessclone_app` with
// a viewer's claim set — the connection the dashboard actually uses, rather
// than a probe role invented here.

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
const PRICING_TABLES = ['rates', 'org_rate_overrides']
const BILLING_TABLES = [
  'tiers',
  'subscriptions',
  'subscription_events',
  'log_artifacts',
]
const EVERY_TABLE = [
  ...ACCOUNT_TABLES,
  ...COLLECTION_TABLES,
  ...PRICING_TABLES,
  ...BILLING_TABLES,
]

describe('the migrations', () => {
  test('apply from empty, in order, and leave every table behind', async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
    `

    for (const name of EVERY_TABLE) {
      expect(tables.map((row) => row.table_name)).toContain(name)
    }
  })

  test('leave no table without row-level security', async () => {
    const unprotected = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `

    // No exceptions any more: ticket 02's probe table went with the probe
    // route when ticket 33 made the tracer report real Turns.
    expect(unprotected.map((row) => row.relname)).toEqual([])
  })

  test('ship each table with at least one policy, in the same migration', async () => {
    // Discovered rather than listed, so a table added by a later migration is
    // covered by this the day it lands. ADR 0001's rule is about every table,
    // not about the ones somebody remembered to add here.
    const unpoliced = await sql<{ relname: string }[]>`
      select c.relname from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and not exists (
           select 1 from pg_policies p
            where p.schemaname = n.nspname and p.tablename = c.relname
         )
    `

    expect(unpoliced.map((row) => row.relname)).toEqual([])
  })
})

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

const sessionIds = async (userId: string) =>
  (
    await asUser(
      userId,
      (tx) => tx<{ session_id: string }[]>`select session_id from turns`,
    )
  ).map((row) => row.session_id)

const seedPolicyFixture = async () => {
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
}

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

describe('the identity index', () => {
  test('stores a re-reported Turn once, without reading first', async () => {
    const { orgId, memberId } = await seed()

    await insertTurn(orgId, memberId, 'agent-1')
    await insertTurn(orgId, memberId, 'agent-1')

    expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 1 }])
  })

  test('dedups a main Session, whose agent id is null', async () => {
    // Without `nulls not distinct` the index would treat every re-report of a
    // main Session as a new row — which is every Turn a person starts.
    const { orgId, memberId } = await seed()

    await insertTurn(orgId, memberId, null)
    await insertTurn(orgId, memberId, null)

    expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 1 }])
  })

  test('keeps an Agent Run apart from the Session that spawned it', async () => {
    const { orgId, memberId } = await seed()

    await insertTurn(orgId, memberId, null)
    await insertTurn(orgId, memberId, 'agent-1')

    expect(await sql`select count(*)::int as n from turns`).toEqual([{ n: 2 }])
  })
})

const projectKeys = async (userId: string) =>
  (
    await asUser(
      userId,
      (tx) => tx<{ key: string }[]>`select key from projects`,
    )
  ).map((row) => row.key)

describe('the policies, from a role that is not the owner', () => {
  beforeEach(seedPolicyFixture)

  // Postgres exempts a superuser and a table's owner from policies, so a plain
  // role is what makes them observable at all. On Supabase this is
  // `authenticated`; here it is a role created for the test.
  //
  // This is not the Seam C suite — ticket 44 owns the full matrix. It is the
  // set of attacks a fresh-eyes review actually landed against an earlier cut
  // of these migrations, each of which passed before the guards below existed.
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

  test('a caller with no identity at all reads nothing', async () => {
    const rows = await asUser(
      null,
      (tx) => tx<{ session_id: string }[]>`select session_id from turns`,
    )

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
    expect(await projectKeys(ids.member)).toEqual(['github.com/acme/api'])
    expect(await projectKeys(ids.idle)).toEqual([])
    expect((await projectKeys(ids.owner)).toSorted()).toEqual([
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
      // Two locks, as the app-role migration says: `turns` carries no insert
      // policy *and* `sessclone_app` is granted no insert on it, so the
      // refusal arrives one layer earlier than row-level security.
    ).rejects.toThrow(/permission denied|row-level security/)
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
  beforeEach(seedPolicyFixture)

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

const shadowing = async <T>(
  table: string,
  columns: string,
  rows: string,
  userId: string,
  query: (tx: postgres.TransactionSql) => Promise<T>,
) => {
  const scratch = postgres(process.env.APP_DATABASE_URL!, { max: 1 })
  try {
    await scratch.unsafe(`create temp table ${table} (${columns})`)
    await scratch.unsafe(`insert into ${table} values ${rows}`)
    return await scratch.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`
      return query(tx)
    })
  } finally {
    await scratch.end()
  }
}

describe('the search path every security definer helper runs on', () => {
  beforeEach(seedPolicyFixture)

  // Each helper was declared `set search_path = public`, which does not mean
  // what it reads as: Postgres searches `pg_temp` before every schema on the
  // path when resolving a relation unless `pg_temp` is named explicitly, and
  // `TEMP` is granted to `PUBLIC`. Every policy in this schema resolves through
  // one of these functions, so a temp table with the right name was a rewrite
  // of what any of them returns.
  //
  // `app-role.test.ts` cannot catch this — it asserts the role is not a
  // superuser, does not bypass policies and owns nothing, all of which stayed
  // true while the flag could be faked.
  test('is not a temp table away from handing somebody the deployment', async () => {
    const claimed = await shadowing(
      'users',
      'id uuid, is_platform_admin boolean',
      `('${ids.member}', true)`,
      ids.member,
      (tx) =>
        tx<{ admin: boolean }[]>`select sessclone_is_platform_admin() as admin`,
    )

    expect(claimed).toEqual([{ admin: false }])
  })

  test('nor a temp table away from another Org', async () => {
    // A temp `members` row saying this Member administers Beta rewrote
    // `sessclone_admin_org_ids()`, and with it every read that resolves
    // through `sessclone_visible_member_ids()`.
    const orgs = await shadowing(
      'members',
      'id uuid, org_id uuid, user_id uuid, role text, removed_at timestamptz',
      `('${ids.memberRow}', '${ids.beta}', '${ids.member}', 'owner', null)`,
      ids.member,
      (tx) =>
        tx<
          { org_id: string }[]
        >`select org_id from sessclone_org_ids() as org_id`,
    )

    expect(orgs.map((row) => row.org_id)).toEqual([ids.acme])
  })
})

test('every security definer function pins pg_temp', async () => {
  // `20260920120600_search_path.sql` exists because ten functions shipped
  // without the pin: Postgres searches `pg_temp` first for a table unless the
  // schema is named, every role has temp rights, and a temp `users` or
  // `members` forged platform-admin or read every Org. Two specific attacks
  // are proven above; this is the class, so the next function cannot
  // reintroduce it.
  const unpinned = await sql<{ name: string; config: string[] | null }[]>`
    select routine.proname as name, routine.proconfig as config
      from pg_proc routine
      join pg_namespace space on space.oid = routine.pronamespace
     where space.nspname = 'public'
       and routine.prosecdef
       and not coalesce(
             array_to_string(routine.proconfig, ',') like '%pg_temp%', false)
     order by routine.proname
  `

  expect(unpinned.map((row) => row.name)).toEqual([])
})
