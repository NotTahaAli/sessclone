import { readFileSync, readdirSync } from 'node:fs'

import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

// Ticket 20, the half of ADR 0007 that Postgres will not enforce for us. The
// policies in the migrations apply to nobody at all on a connection that owns
// the tables, so a policy test is only evidence if it connects the way the
// dashboard connects: as `sessclone_app`, which owns nothing.
//
// Both directions are asserted on the same query. A read denied to an Org the
// viewer does not belong to proves nothing on its own — a broken claim, a
// missing grant or an empty table denies it just as well — so the same viewer
// must also see their own Org's Turn.
const owner = postgres(process.env.DATABASE_URL!)
const app = postgres(process.env.APP_DATABASE_URL!)

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url)

const ours = {
  org: '11111111-1111-4111-8111-111111111111',
  user: '11111111-1111-4111-8111-222222222222',
  member: '11111111-1111-4111-8111-333333333333',
}
const theirs = {
  org: '99999999-9999-4999-8999-111111111111',
  user: '99999999-9999-4999-8999-222222222222',
  member: '99999999-9999-4999-8999-333333333333',
}

// The dashboard's only way to hold a connection: a transaction with the
// viewer's claim set on it, exactly as ADR 0007 describes. Transaction-local,
// so the pooled connection carries no identity back.
const asViewer = async <T>(
  userId: string | null,
  query: (tx: postgres.TransactionSql) => Promise<T>,
) =>
  app.begin(async (tx) => {
    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId })}'`,
    )
    return query(tx)
  })

beforeAll(async () => {
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  if (!database.endsWith('_test')) {
    throw new Error(`refusing to reset ${database}: not a _test database`)
  }

  await owner.unsafe('drop schema public cascade; create schema public')

  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- migrations apply in order.
    await owner.unsafe(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }

  // Seeded as the owner, which is also how ingest writes: `turns` has no
  // insert policy, and this inserting at all is the proof that it still does
  // not need one.
  for (const side of [ours, theirs]) {
    // oxlint-disable-next-line no-await-in-loop -- two rows, order is clearer.
    await owner`
      with o as (insert into orgs (id, name) values (${side.org}, ${side.org}) returning id),
           u as (insert into users (id, email) values (${side.user}, ${side.user + '@example.test'}) returning id),
           m as (
             insert into members (id, org_id, user_id, role)
             select ${side.member}, o.id, u.id, 'owner' from o, u returning id, org_id
           )
      insert into turns (org_id, member_id, session_id, message_id, occurred_at, input_tokens)
      select m.org_id, m.id, 'session-' || m.id, 'message-' || m.id, now(), 7 from m
    `
  }
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('the connection the dashboard reads on', () => {
  test('is subject to policies at all: it owns nothing and bypasses nothing', async () => {
    const [role] = await app<
      { rolsuper: boolean; rolbypassrls: boolean; owns: number }[]
    >`
      select r.rolsuper, r.rolbypassrls,
             (select count(*)::int from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relkind = 'r'
                 and c.relowner = r.oid) as owns
        from pg_roles r where r.rolname = current_user
    `

    // Any of the three is the whole hole: Postgres silently applies no policy
    // to a superuser, to a `bypassrls` role, or to a table's owner.
    expect(role).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      owns: 0,
    })
  })

  test('refuses another Org whose Turn it can name, and serves its own', async () => {
    const visible = await asViewer(
      ours.user,
      (tx) =>
        tx<{ org_id: string; input_tokens: number }[]>`
        select org_id, input_tokens from turns order by org_id
      `,
    )

    expect(visible).toEqual([{ org_id: ours.org, input_tokens: 7 }])

    // Named directly rather than left to a table scan: the row exists, the
    // viewer can spell its id, and the policy is the only thing between them.
    const named = await asViewer(
      ours.user,
      (tx) =>
        tx<{ id: string }[]>`select id from turns where org_id = ${theirs.org}`,
    )

    expect(named).toEqual([])
  })

  test('sees nothing at all with no claim set', async () => {
    const orphaned = await asViewer(
      null,
      (tx) => tx<{ id: string }[]>`select id from turns`,
    )

    expect(orphaned).toEqual([])
  })
})
