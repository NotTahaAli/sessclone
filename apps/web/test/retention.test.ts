import { beforeEach, expect, test, vi } from 'vitest'

import { orgRetention, setOrgRetention } from '../lib/org'
import { expiredCount, sweepRetention } from '../lib/retention'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 61: the window, its Tier ceiling, and the sweep — against a real
// Postgres with the real migrations.
//
// Storage is stubbed so the deletion can be observed and made to fail, which
// is the case that matters: a sweep that removes rows whose objects it could
// not delete leaves a transcript nobody can find and nobody can remove.

const bucket = vi.hoisted(() => ({
  deleted: [] as string[],
  fails: false,
  configured: true,
}))

vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  storageConfigured: () => bucket.configured,
  deleteObjects: async (keys: string[]) => {
    if (bucket.fails) throw new Error('the bucket refused')
    bucket.deleted.push(...keys)
  },
}))

let fixture: Fixture
let nth = 0

const withTier = async (
  orgId: string,
  retentionMaxDays: number | null,
  status = 'active',
) => {
  nth += 1
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, retention_max_days, sort_order)
    values (${`tier-${nth}`}, 'Team', 10, ${retentionMaxDays}, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${orgId}, ${tier!.id}, ${status})
    on conflict (org_id) do update
      set tier_id = excluded.tier_id, status = excluded.status
  `
}

/** An artifact uploaded `age` days ago. */
const seedArtifact = async ({
  org = '',
  memberId = '',
  age,
}: {
  org?: string
  memberId?: string
  age: number
}) => {
  nth += 1
  const orgId = org || fixture.acme.id
  const member = memberId || fixture.acme.members.member
  const key = `orgs/${orgId}/members/${member}/projects/none/session-${nth}.jsonl`
  await sql`
    insert into log_artifacts ${sql({
      org_id: orgId,
      member_id: member,
      session_id: `session-${nth}`,
      storage_key: key,
      sha256: 'a'.repeat(64),
      size_bytes: 1024,
      uploaded_at: new Date(Date.now() - age * 86_400_000),
    })}
  `
  return key
}

beforeEach(async () => {
  fixture = await seedFixture()
  bucket.deleted = []
  bucket.fails = false
  bucket.configured = true
})

test('an Org starts with a window it did not have to choose', async () => {
  // "Keep forever" is not a decision anybody made, and a deployment that kept
  // every transcript by omission is the failure ADR 0005 is about.
  const retention = await asRole(fixture.acme, 'owner', (tx) =>
    orgRetention(tx, fixture.acme.id),
  )
  expect(retention).toMatchObject({ days: 90 })
})

test('an Owner and an Admin may set it; a Manager and a Member may not', async () => {
  for (const role of ['owner', 'admin'] as const) {
    // eslint-disable-next-line no-await-in-loop -- one role at a time, so a failure names which
    const written = await asRole(fixture.acme, role, (tx) =>
      setOrgRetention(tx, fixture.acme.id, 30),
    )
    expect(written, role).toBe(true)
  }

  for (const role of ['manager', 'member'] as const) {
    // A write refused by `orgs_write` touches no rows and raises nothing.
    // eslint-disable-next-line no-await-in-loop -- as above
    const written = await asRole(fixture.acme, role, (tx) =>
      setOrgRetention(tx, fixture.acme.id, 7),
    )
    expect(written, role).toBe(false)
  }

  const [row] = await sql<{ retention_days: number }[]>`
    select retention_days from orgs where id = ${fixture.acme.id}
  `
  expect(row!.retention_days).toBe(30)
})

test('the Tier’s ceiling is refused by the database, not by a form', async () => {
  await withTier(fixture.acme.id, 90)

  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setOrgRetention(tx, fixture.acme.id, 365),
    ),
  ).rejects.toThrow(/ceiling/)

  // And up to the ceiling is fine.
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setOrgRetention(tx, fixture.acme.id, 90),
    ),
  ).toBe(true)
})

test('a Tier with no ceiling, and an Org with no subscription, are unbounded', async () => {
  await withTier(fixture.acme.id, null)
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setOrgRetention(tx, fixture.acme.id, 3650),
    ),
  ).toBe(true)

  // An inactive subscription is not an entitlement (ADR 0004) — but a ceiling
  // is a restriction, and inventing one would delete the transcripts of every
  // Org an operator has not activated yet.
  await withTier(fixture.globex.id, 30, 'cancelled')
  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      setOrgRetention(tx, fixture.globex.id, 365),
    ),
  ).toBe(true)
})

test('the sweep removes what is past the window, rows and objects together', async () => {
  await sql`update orgs set retention_days = 30 where id = ${fixture.acme.id}`
  const old = await seedArtifact({ age: 31 })
  const older = await seedArtifact({ age: 400 })
  await seedArtifact({ age: 29 })

  expect(await expiredCount(sql)).toBe(2)

  const swept = await sweepRetention(sql)

  expect(swept).toEqual({ removed: 2, more: false })
  expect(bucket.deleted.toSorted()).toEqual([old, older].toSorted())
  const rows = await sql`select id from log_artifacts`
  expect(rows).toHaveLength(1)
  expect(await expiredCount(sql)).toBe(0)
})

test('each Org’s own window decides, and a shrunk Tier ceiling wins', async () => {
  await sql`update orgs set retention_days = 365 where id = ${fixture.acme.id}`
  await sql`update orgs set retention_days = 7 where id = ${fixture.globex.id}`
  const acme = await seedArtifact({ age: 100 })
  const globex = await seedArtifact({
    org: fixture.globex.id,
    memberId: fixture.globex.members.member,
    age: 100,
  })

  // Globex keeps a week, so its artifact goes and Acme's stays.
  expect((await sweepRetention(sql)).removed).toBe(1)
  expect(bucket.deleted).toEqual([globex])

  // Now Acme's Tier drops to 30 days. The setting is still 365 and the
  // trigger cannot reach it retroactively, so the sweep applies the lower of
  // the two — otherwise a Tier downgrade would keep transcripts it no longer
  // allows.
  await withTier(fixture.acme.id, 30)
  expect((await sweepRetention(sql)).removed).toBe(1)
  expect(bucket.deleted).toEqual([globex, acme])
})

test('a sweep is bounded, says whether more remain, and drains oldest first', async () => {
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  const oldest = await seedArtifact({ age: 40 })
  const middle = await seedArtifact({ age: 30 })
  await seedArtifact({ age: 20 })

  const first = await sweepRetention(sql, 2)
  expect(first).toEqual({ removed: 2, more: true })
  expect(bucket.deleted).toEqual([oldest, middle])

  const second = await sweepRetention(sql, 2)
  expect(second).toEqual({ removed: 1, more: false })
})

test('a sweep is idempotent and safe to re-run', async () => {
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })

  expect((await sweepRetention(sql)).removed).toBe(1)
  expect(await sweepRetention(sql)).toEqual({ removed: 0, more: false })
  expect(bucket.deleted).toHaveLength(1)
})

test('a bucket that refuses keeps the rows, so nothing points at nothing', async () => {
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })
  bucket.fails = true

  await expect(sweepRetention(sql)).rejects.toThrow(/refused/)

  // The transaction rolled back: the row is still there, and still finds its
  // bytes. The alternative — a row deleted and an object left — is a
  // transcript no retention path can ever reach.
  expect(await sql`select id from log_artifacts`).toHaveLength(1)
})

test('retention never touches Turns', async () => {
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })
  await sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: 'session-old',
      message_id: 'msg_old',
      occurred_at: new Date(Date.now() - 400 * 86_400_000),
      model: 'claude-opus-4-6',
      input_tokens: 10,
    })}
  `

  await sweepRetention(sql)

  // The spend history outlives every transcript it describes.
  expect(await sql`select id from turns`).toHaveLength(1)
})

test('a forged `tiers` in pg_temp cannot lift the ceiling', async () => {
  // The guard is `security definer`, so `set search_path = public, pg_temp` is
  // the whole defence: Postgres searches `pg_temp` first for tables unless the
  // schema is named, and every role has temp rights. Without the pin, these
  // two temp tables are what the trigger reads.
  await withTier(fixture.acme.id, 30)

  await expect(
    asRole(fixture.acme, 'owner', async (tx) => {
      await tx`create temp table tiers (id uuid, retention_max_days integer)`
      await tx`create temp table subscriptions (org_id uuid, tier_id uuid, status text)`
      await tx`insert into tiers values (gen_random_uuid(), 3650)`
      await tx`
        insert into subscriptions
        select ${fixture.acme.id}, id, 'active' from tiers
      `
      return setOrgRetention(tx, fixture.acme.id, 3650)
    }),
  ).rejects.toThrow(/ceiling of 30 days/)
})

test('the sweep endpoint is a secret, not a session', async () => {
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })

  // Unset refuses every call: this destroys transcripts, so the default is
  // closed rather than open.
  delete process.env.RETENTION_SWEEP_SECRET
  expect((await sweep('anything')).status).toBe(503)

  process.env.RETENTION_SWEEP_SECRET = 'a-real-secret'
  expect((await sweep()).status).toBe(401)
  expect((await sweep('a-real-secre')).status).toBe(401)
  expect((await sweep('a-real-secretx')).status).toBe(401)
  // Nothing was removed by any refusal.
  expect(await sql`select id from log_artifacts`).toHaveLength(1)

  const answer = await sweep('a-real-secret')
  expect(answer.status).toBe(200)
  expect(await answer.json()).toEqual({ removed: 1, remaining: 0 })
  expect(bucket.deleted).toHaveLength(1)

  delete process.env.RETENTION_SWEEP_SECRET
})

/** One call to the sweep endpoint; no `secret` means no header at all. */
const sweep = async (secret?: string) => {
  const { POST } = await import('../app/api/retention/sweep/route')
  return POST(
    new Request('https://sessclone.test/api/retention/sweep', {
      method: 'POST',
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
  )
}

test('the endpoint answers the backlog, and removes nothing it cannot delete', async () => {
  process.env.RETENTION_SWEEP_SECRET = 'a-real-secret'
  const ask = () => sweep('a-real-secret')

  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  bucket.fails = true
  await seedArtifact({ age: 10 })

  // A bucket that refuses is a 503 and an unchanged deployment, not a partial
  // success nobody can reconstruct.
  const refused = await ask()
  expect(refused.status).toBe(503)
  expect(await sql`select id from log_artifacts`).toHaveLength(1)

  // Storage that is not configured at all is refused before any row is read,
  // for the same reason: rows and objects go together or not at all.
  bucket.fails = false
  bucket.configured = false
  expect((await ask()).status).toBe(503)
  expect(await sql`select id from log_artifacts`).toHaveLength(1)

  bucket.configured = true
  expect(await (await ask()).json()).toEqual({ removed: 1, remaining: 0 })

  delete process.env.RETENTION_SWEEP_SECRET
})
