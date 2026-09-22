import { randomUUID } from 'node:crypto'

import { beforeEach, describe, expect, test } from 'vitest'

import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 27, less the click-through. What a real GitHub or magic-link sign-in
// hands this application is a verified user id and an email; everything after
// that point is what runs here, against real Postgres with the real policies,
// on the same connection the application uses.
//
// `lib/db.ts` connects as `DATABASE_URL`, which in a deployment is
// `sessclone_app` — ADR 0007 requires a role that neither owns the tables nor
// is a superuser, or the policies apply to nobody. In this suite that variable
// is the owner, because the harness applies migrations and seeds with it, so
// the application's connection is repointed at the app role for this file
// before anything opens a pool. Without that, every assertion below would pass
// with row-level security silently disabled — which is exactly the failure
// `app-role.test.ts` exists to catch.
// The harness import above is static on purpose: its pools are built as it
// evaluates, which is before this line runs, so `owner` keeps the owner's URL
// while the application's lazily-built pool picks up the app role's. Making it
// a dynamic import below this line would repoint the harness too, and the
// seeding would start failing its own policies.
process.env.DATABASE_URL = process.env.APP_DATABASE_URL

const { ensureOrgForSigner } = await import('../lib/auth/bootstrap')

let fixture: Fixture

const signIn = (email: string, id = randomUUID()) =>
  ensureOrgForSigner(id, email).then((org) => ({ ...org, userId: id }))

beforeEach(async () => {
  fixture = await seedFixture()
})

describe('the first time somebody signs in', () => {
  test('creates their user row, an Org, and makes them its Owner', async () => {
    const signer = await signIn('first@example.test')

    const [row] = await sql<
      {
        email: string
        role: string
        org_name: string
        is_platform_admin: boolean
      }[]
    >`
      select u.email, m.role, o.name as org_name, u.is_platform_admin
        from members m
        join users u on u.id = m.user_id
        join orgs o on o.id = m.org_id
       where m.id = ${signer.memberId}
    `

    expect(row).toEqual({
      email: 'first@example.test',
      role: 'owner',
      org_name: "first's Org",
      // Nobody hands themselves the deployment by signing in.
      is_platform_admin: false,
    })
  })

  test('never creates or stores a password', async () => {
    await signIn('first@example.test')

    // Not a proof that no code path sets one — there is no such path, because
    // neither `signUp` nor `signInWithPassword` is called anywhere. It is the
    // schema half of the same promise: there is no column to put one in.
    const columns = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'users'
    `

    expect(columns.map((row) => row.column_name)).toEqual([
      'id',
      'email',
      'is_platform_admin',
      'created_at',
      // Ticket 91. A name, which is not a credential: it is written by the
      // person themselves under `users_write_self` and read by whoever may
      // already read their address.
      'display_name',
    ])
  })
})

describe('signing out and back in', () => {
  test('returns the same Org, not a second one', async () => {
    const first = await signIn('returning@example.test')
    const second = await ensureOrgForSigner(
      first.userId,
      'returning@example.test',
    )

    expect(second).toEqual({ orgId: first.orgId, memberId: first.memberId })
    expect(await sql`select count(*)::int as n from orgs`).toEqual([{ n: 3 }])
  })

  test('returns an existing Member to the Org they were invited into', async () => {
    // Somebody invited into an Org (ticket 49) signs in for the first time and
    // must land there rather than in an Org of their own — which is the case
    // that makes this run on every sign-in rather than only the first.
    const invited = await ensureOrgForSigner(
      fixture.acme.users.member,
      'member@acme.test',
    )

    expect(invited.orgId).toBe(fixture.acme.id)
    expect(invited.memberId).toBe(fixture.acme.members.member)
  })

  test('gives a removed Member a new Org rather than their old one back', async () => {
    const removed = await ensureOrgForSigner(
      fixture.acme.users.removed,
      'removed@acme.test',
    )

    // `members_read` deliberately shows a removed Member nothing, themselves
    // included, so there is no membership here to return to. Handing them a
    // fresh Org is the right answer: they are a new customer, and the Org that
    // removed them keeps their history.
    expect(removed.orgId).not.toBe(fixture.acme.id)
  })
})

describe('an email that already belongs to another account', () => {
  test('refuses the sign-in rather than signing them in with no Org', async () => {
    // Reachable two ways: a Supabase project that does not link a GitHub
    // identity to an existing magic-link account issues a second id for one
    // address, and ticket 49's invite creates the `users` row before the
    // invitee has ever signed in.
    await expect(
      ensureOrgForSigner(randomUUID(), 'member@acme.test'),
    ).rejects.toThrow(/already signed up under a different identity/)
  })

  test('and leaves nothing half-created behind', async () => {
    const before = await sql<
      { n: number }[]
    >`select count(*)::int as n from orgs`

    await ensureOrgForSigner(randomUUID(), 'member@acme.test').catch(() => {})

    // The transaction rolls back, so there is no Org nobody belongs to. The
    // earlier failure mode signed them in, left no `users` row, and failed
    // `members_user_id_fkey` on every subsequent attempt.
    expect(await sql`select count(*)::int as n from orgs`).toEqual(before)
  })
})

describe('the policy that lets a signer create their own user row', () => {
  test('refuses a row for somebody else', async () => {
    await expect(
      asUser(
        fixture.acme.users.member,
        (tx) => tx`
          insert into users (id, email)
          values (${randomUUID()}, 'someone-else@example.test')
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  test('refuses a row that arrives already holding the platform admin flag', async () => {
    // The update trigger has always refused to *grant* the flag. Without the
    // `not is_platform_admin` in the insert check, the way around it would be
    // to arrive with it.
    const id = randomUUID()

    await expect(
      asUser(
        id,
        (tx) => tx`
          insert into users (id, email, is_platform_admin)
          values (${id}, 'operator-wannabe@example.test', true)
        `,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  test('and lets a signer create exactly their own', async () => {
    const id = randomUUID()

    await asUser(
      id,
      (tx) =>
        tx`insert into users (id, email) values (${id}, 'self@example.test')`,
    )

    expect(
      await sql<{ email: string }[]>`select email from users where id = ${id}`,
    ).toEqual([{ email: 'self@example.test' }])
  })
})
