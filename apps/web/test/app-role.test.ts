import { beforeEach, describe, expect, test } from 'vitest'

import { app, asUser, owner, seedFixture, type Fixture } from './harness'

// Ticket 20, the half of ADR 0007 that Postgres will not enforce for us. The
// policies in the migrations apply to nobody at all on a connection that owns
// the tables, so a policy test is only evidence if it connects the way the
// dashboard connects: as `sessclone_app`, which owns nothing. That connection
// is `asUser`, and this file is what proves it is worth anything.
//
// Both directions are asserted on the same query. A read denied to an Org the
// viewer does not belong to proves nothing on its own — a broken claim, a
// missing grant or an empty table denies it just as well — so the same viewer
// must also see their own Org's Turn.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()

  // Seeded as the owner, which is also how ingest writes: `turns` has no
  // insert policy, and this inserting at all is the proof that it still does
  // not need one.
  for (const org of [fixture.acme, fixture.globex]) {
    // oxlint-disable-next-line no-await-in-loop -- two rows, order is clearer.
    await owner`
      insert into turns (org_id, member_id, session_id, message_id, occurred_at, input_tokens)
      values (${org.id}, ${org.members.owner}, ${'session-' + org.name}, ${'message-' + org.name}, now(), 7)
    `
  }
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
    const visible = await asUser(
      fixture.acme.users.owner,
      (tx) =>
        tx<{ org_id: string; input_tokens: number }[]>`
        select org_id, input_tokens from turns
      `,
    )

    expect(visible).toEqual([{ org_id: fixture.acme.id, input_tokens: 7 }])

    // Named directly rather than left to a table scan: the row exists, the
    // viewer can spell its id, and the policy is the only thing between them.
    const named = await asUser(
      fixture.acme.users.owner,
      (tx) =>
        tx<{ id: string }[]>`
          select id from turns where org_id = ${fixture.globex.id}
        `,
    )

    expect(named).toEqual([])
  })

  test('sees nothing at all with no claim set', async () => {
    const orphaned = await asUser(
      null,
      (tx) => tx<{ id: string }[]>`select id from turns`,
    )

    expect(orphaned).toEqual([])
  })
})
