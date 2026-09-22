import { readFileSync, readdirSync } from 'node:fs'

import postgres from 'postgres'

// Ticket 25: the rig every database-touching test uses.
//
// Three files used to carry their own copy of "drop the schema, apply every
// migration, hope no other file is doing the same thing". They raced — two
// files dropping the schema under each other is a failure that looks like a
// missing table — and each new migration meant remembering to look at all
// three. This is that code, once.
//
// The shape is deliberate. Migrations apply once per run, in `global-setup.ts`.
// Every test then starts from an empty database because `setup.ts` truncates
// between tests, so no test depends on what ran before it, and a test that
// wants rows seeds them itself.

const MIGRATIONS = new URL('../../../supabase/migrations/', import.meta.url)

/**
 * The role that owns the tables. It applies the migrations and seeds the
 * fixtures — and, owning them, Postgres applies no policy to it. Nothing a
 * policy test asserts should be read on this connection.
 *
 * It is also how ingest writes (ADR 0001): `turns` and `log_artifacts` carry
 * no insert policy by design, so seeding through this connection is the same
 * path the real writer takes.
 */
export const owner = postgres(process.env.DATABASE_URL!)

/**
 * `sessclone_app`: owns nothing, bypasses nothing, and is what the dashboard
 * connects as (ADR 0007). The only connection on which a policy test is
 * evidence of anything.
 */
export const app = postgres(process.env.APP_DATABASE_URL!)

/**
 * Applies every migration to an empty schema, in filename order. Called once
 * per run by the project's `globalSetup`; a test file should never need it.
 */
export const applyMigrations = async () => {
  // The drop below is unrecoverable, so refuse any database not named as a
  // test one. A mistyped DATABASE_URL should fail, not empty someone's data.
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  if (!database.endsWith('_test')) {
    throw new Error(`refusing to reset ${database}: not a _test database`)
  }

  // `drop … cascade` reports every dependent object it removes as a NOTICE,
  // which is a screenful of noise above the test results and tells nobody
  // anything: the schema is about to be rebuilt from the migrations.
  await owner.unsafe(
    'set client_min_messages = warning; drop schema public cascade; create schema public',
  )

  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .toSorted()

  for (const file of files) {
    // oxlint-disable-next-line no-await-in-loop -- migrations apply in order.
    await owner.unsafe(readFileSync(new URL(file, MIGRATIONS), 'utf8'))
  }
}

/**
 * Empties every table, discovered from the catalogue rather than listed here —
 * so a migration that adds a table needs no edit in this file, which is how
 * the per-file copies of this rotted.
 *
 * `restart identity` so the `bigint generated always as identity` keys on
 * `turns` and `subscription_events` start from 1 in each test, and `cascade`
 * because truncating a referenced table needs it even when every referencing
 * table is in the same statement.
 */
export const resetDatabase = async () => {
  const tables = await owner<{ name: string }[]>`
    select quote_ident(c.relname) as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  `

  if (tables.length === 0) return

  await owner.unsafe(
    `truncate ${tables.map((row) => row.name).join(', ')} restart identity cascade`,
  )
}

/** Closes both pools. `setup.ts` does this once per test file. */
export const closeConnections = async () => {
  await Promise.all([owner.end(), app.end()])
}

/**
 * The only way a test reads as somebody. It opens a transaction, sets that
 * viewer's claim on it, and runs the query inside — which is exactly what ADR
 * 0007 says the dashboard's connection function does, so a policy proven here
 * is proven on the real read path rather than on an approximation of it.
 *
 * The claim is transaction-local: a pooled connection carries no identity back
 * to the next caller.
 */
export const asUser = async <T>(
  userId: string | null,
  query: (tx: postgres.TransactionSql) => Promise<T>,
) =>
  app.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`
    return query(tx)
  })

/** The people the fixture creates in each Org, and the one outside every Org. */
export type FixtureRole =
  'owner' | 'admin' | 'manager' | 'managerWithoutScope' | 'member' | 'removed'

export type FixtureOrg = {
  id: string
  name: string
  /** Member row ids, by Role. */
  members: Record<FixtureRole, string>
  /** User ids, by Role. */
  users: Record<FixtureRole, string>
}

export type Fixture = {
  acme: FixtureOrg
  globex: FixtureOrg
  /** Outside every Org. `is_platform_admin`, which is a flag and not a Role. */
  platformAdmin: { userId: string }
  /** Signed in, belongs to nothing. What a policy denies by default. */
  stranger: { userId: string }
}

const ROLES: { key: FixtureRole; role: string; removed: boolean }[] = [
  { key: 'owner', role: 'owner', removed: false },
  { key: 'admin', role: 'admin', removed: false },
  { key: 'manager', role: 'manager', removed: false },
  { key: 'managerWithoutScope', role: 'manager', removed: false },
  { key: 'member', role: 'member', removed: false },
  { key: 'removed', role: 'member', removed: true },
]

/**
 * Builds a record over every Role, so the fixture's two lookups are spelled
 * out rather than asserted into shape from a partially-filled object.
 */
const byRole = <T>(value: (key: FixtureRole) => T): Record<FixtureRole, T> => ({
  owner: value('owner'),
  admin: value('admin'),
  manager: value('manager'),
  managerWithoutScope: value('managerWithoutScope'),
  member: value('member'),
  removed: value('removed'),
})

const seedOrg = async (name: string): Promise<FixtureOrg> => {
  const [org] = await owner<{ id: string }[]>`
    insert into orgs (name) values (${name}) returning id
  `

  const seeded = new Map<FixtureRole, { userId: string; memberId: string }>()

  for (const { key, role, removed } of ROLES) {
    const email = `${key}@${name.toLowerCase()}.test`
    // oxlint-disable-next-line no-await-in-loop -- six rows, order is clearer.
    const [row] = await owner<{ user_id: string; member_id: string }[]>`
      with u as (insert into users (email) values (${email}) returning id)
      insert into members (org_id, user_id, role, removed_at)
      select ${org!.id}, u.id, ${role}::member_role,
             ${removed ? new Date() : null}::timestamptz
        from u
      returning user_id, id as member_id
    `
    seeded.set(key, { userId: row!.user_id, memberId: row!.member_id })
  }

  const members = byRole((key) => seeded.get(key)!.memberId)
  const users = byRole((key) => seeded.get(key)!.userId)

  // One Manager sees exactly one Member; the other sees nobody. The second is
  // not an oversight in the fixture — an empty Scope is the default, and a
  // policy that leaks does it most visibly to the Manager who should see
  // nothing at all.
  await owner`
    insert into member_scopes (org_id, manager_member_id, member_id)
    values (${org!.id}, ${members.manager}, ${members.member})
  `

  return { id: org!.id, name, members, users }
}

/**
 * Two Orgs, each with a person in every Role, a Manager with a Scope and a
 * Manager without one, and a removed Member. Two Orgs because every
 * cross-Org assertion needs a second Org whose rows genuinely exist — a read
 * that returns nothing proves nothing when there was nothing to return.
 *
 * Seeded as the owner, which is also how ingest writes.
 */
export const seedFixture = async (): Promise<Fixture> => {
  const acme = await seedOrg('Acme')
  const globex = await seedOrg('Globex')

  const [platformAdmin] = await owner<{ id: string }[]>`
    insert into users (email, is_platform_admin)
    values ('operator@sessclone.test', true) returning id
  `
  const [stranger] = await owner<{ id: string }[]>`
    insert into users (email) values ('stranger@nowhere.test') returning id
  `

  return {
    acme,
    globex,
    platformAdmin: { userId: platformAdmin!.id },
    stranger: { userId: stranger!.id },
  }
}

/** Reads as one of the fixture's people. `asUser` with the id looked up. */
export const asRole = <T>(
  org: FixtureOrg,
  role: FixtureRole,
  query: (tx: postgres.TransactionSql) => Promise<T>,
) => asUser(org.users[role], query)

/**
 * A transaction with no claim at all, as the dashboard's unprivileged role —
 * what `lib/db.ts`'s `readAnonymously` opens for the public pricing pages.
 *
 * `sessclone_user_id()` is null inside it, so every policy that tests it
 * refuses. `tiers_read` is `using (true)` and does not.
 */
export const anonymous = <T>(
  query: (tx: postgres.TransactionSql) => Promise<T>,
) => app.begin((tx) => query(tx))
