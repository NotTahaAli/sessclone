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

beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  if (!database.endsWith('_test')) {
    throw new Error(`refusing to reset ${database}: not a _test database`)
  }

  await sql.unsafe('drop schema public cascade; create schema public')

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- migrations apply in order.
    await sql.unsafe(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
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

describe('the policies are not inert', () => {
  // A smoke test, not the Seam C suite — ticket 44 owns the full Role matrix.
  // This asks only whether the rules are enforced at all, because a policy
  // that is never exercised from a non-owner role is a policy nobody has run.
  let acme = { orgId: '', memberId: '', userId: '' }
  let other = { orgId: '', memberId: '', userId: '' }

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

  const seedOrg = async (name: string, email: string) => {
    const [org] = await sql<{ id: string }[]>`
      insert into orgs (name) values (${name}) returning id
    `
    const [user] = await sql<{ id: string }[]>`
      insert into users (email) values (${email}) returning id
    `
    const [member] = await sql<{ id: string }[]>`
      insert into members (org_id, user_id, role)
      values (${org!.id}, ${user!.id}, 'member') returning id
    `
    await sql`
      insert into turns (org_id, member_id, session_id, message_id, occurred_at, output_tokens)
      values (${org!.id}, ${member!.id}, ${name}, 'msg_1', now(), 10)
    `
    return { orgId: org!.id, memberId: member!.id, userId: user!.id }
  }

  beforeAll(async () => {
    // Postgres exempts a superuser and a table's owner from policies, so a
    // plain role is what makes them observable at all. On Supabase this is
    // `authenticated`; here it is a role created for the test.
    await sql.unsafe(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'sessclone_rls_probe') then
          create role sessclone_rls_probe;
        end if;
      end $$;
      grant usage on schema public to sessclone_rls_probe;
      grant select, insert, update, delete on all tables in schema public to sessclone_rls_probe;
    `)
    await sql`truncate turns, member_scopes, api_keys, members, users, orgs cascade`
    acme = await seedOrg('acme', 'acme@example.com')
    other = await seedOrg('other', 'other@example.com')
  })

  test('a Member reads their own Turns', async () => {
    const rows = await asUser(
      acme.userId,
      (tx) => tx`select session_id from turns`,
    )

    expect(rows).toEqual([{ session_id: 'acme' }])
  })

  test('and reads nothing from another Org', async () => {
    const rows = await asUser(
      other.userId,
      (tx) => tx`select session_id from turns`,
    )

    expect(rows).toEqual([{ session_id: 'other' }])
  })

  test('a caller with no identity at all reads nothing', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`set local role sessclone_rls_probe`
      return tx`select session_id from turns`
    })

    expect(rows).toEqual([])
  })

  test('a Member cannot flip another Member archival switch', async () => {
    await expect(
      asUser(
        acme.userId,
        (tx) =>
          tx`update members set archival_enabled = true where id = ${other.memberId}`,
      ),
    ).resolves.toMatchObject({ count: 0 })

    const [row] = await sql<{ archival_enabled: boolean }[]>`
      select archival_enabled from members where id = ${other.memberId}
    `
    expect(row?.archival_enabled).toBe(false)
  })

  test('a Member may flip their own', async () => {
    await asUser(
      acme.userId,
      (tx) =>
        tx`update members set archival_enabled = true where id = ${acme.memberId}`,
    )

    const [row] = await sql<{ archival_enabled: boolean }[]>`
      select archival_enabled from members where id = ${acme.memberId}
    `
    expect(row?.archival_enabled).toBe(true)
  })

  test('a Member cannot promote themselves', async () => {
    await expect(
      asUser(
        acme.userId,
        (tx) =>
          tx`update members set role = 'owner' where id = ${acme.memberId}`,
      ),
    ).rejects.toThrow(/only an owner or admin may change a role/)
  })

  test('nobody writes a Turn through a policy', async () => {
    // `turns` is append-only and ingest writes it with the service role, which
    // bypasses policies. There is no insert policy, so this is refused.
    await expect(
      asUser(
        acme.userId,
        (tx) => tx`
          insert into turns (org_id, member_id, session_id, message_id, occurred_at)
          values (${acme.orgId}, ${acme.memberId}, 'forged', 'msg_forged', now())
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })
})
