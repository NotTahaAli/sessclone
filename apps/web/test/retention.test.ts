import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { orgRetention, setOrgRetention } from '../lib/org'
import {
  expiredCount,
  sweepRetention,
  transcriptsEndOn,
} from '../lib/retention'
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

/** Ticket 141's part of the answer, when nobody is due. */
const NO_ACCOUNTS = { scrubbed: 0, signInsRemoved: 0, signInsFailed: 0 }

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

afterEach(() => {
  // Set inline by the route tests. Left behind by a failure between the two
  // statements, it is a live secret for every sibling test in the process.
  delete process.env.RETENTION_SWEEP_SECRET
})

/** An artifact first stored `age` days ago. */
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
      created_at: new Date(Date.now() - age * 86_400_000),
      // Re-uploaded just now, which is the case that used to defeat the
      // window: the sweep measures `created_at` and this moves on every
      // replacement.
      uploaded_at: new Date(),
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

test('an expired transcript takes its sidecars with it, however new they are', async () => {
  // Ticket 104: a run's `.meta.json` and a workflow's journal are written
  // later than the transcript they describe, and must not outlive it.
  await sql`update orgs set retention_days = 30 where id = ${fixture.acme.id}`
  const main = await seedArtifact({ age: 31 })
  const sessionId = `session-${nth}`
  const sidecar = async (agentId: string | null, kind: string) => {
    const key = `${main}.${kind}.${agentId}`
    await sql`
      insert into log_artifacts ${sql({
        org_id: fixture.acme.id,
        member_id: fixture.acme.members.member,
        session_id: sessionId,
        agent_id: agentId,
        kind,
        storage_key: key,
        sha256: 'a'.repeat(64),
        size_bytes: 10,
      })}
    `
    return key
  }
  const run = await sidecar('agent-7', 'transcript')
  const journal = await sidecar('wf_1', 'workflow_journal')
  const meta = await sidecar('agent-7', 'agent_meta')

  const swept = await sweepRetention(sql)

  // The Agent Run's transcript is new and stays, and so does its sidecar; the
  // main transcript's journal goes with it.
  expect(swept).toEqual({ removed: 2, more: false })
  expect(bucket.deleted.toSorted()).toEqual([main, journal].toSorted())
  const left = await sql<{ storage_key: string }[]>`
    select storage_key from log_artifacts order by storage_key
  `
  expect(left.map((row) => row.storage_key)).toEqual([run, meta].toSorted())
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
  expect(await answer.json()).toEqual({
    removed: 1,
    remaining: 0,
    accounts: NO_ACCOUNTS,
  })
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
  expect(await (await ask()).json()).toEqual({
    removed: 1,
    remaining: 0,
    accounts: NO_ACCOUNTS,
  })

  delete process.env.RETENTION_SWEEP_SECRET
})

/** A Vercel Cron call: GET, with the secret as a bearer or no header at all. */
const cronRequest = (secret?: string) =>
  new Request('https://sessclone.test/api/retention/sweep', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })

test('a scheduled GET sweeps like a POST', async () => {
  // Vercel Cron calls the production URL with GET and `Bearer $CRON_SECRET`,
  // so a POST-only route answered it 405 and nothing was ever swept.
  process.env.RETENTION_SWEEP_SECRET = 'a-real-secret'
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })

  const { GET } = await import('../app/api/retention/sweep/route')
  expect((await GET(cronRequest())).status).toBe(401)
  expect(await sql`select id from log_artifacts`).toHaveLength(1)
  expect(await (await GET(cronRequest('a-real-secret'))).json()).toEqual({
    removed: 1,
    remaining: 0,
    accounts: NO_ACCOUNTS,
  })

  delete process.env.RETENTION_SWEEP_SECRET
})

test('a transcript that keeps being re-uploaded still ages out', async () => {
  // `uploaded_at` moves every time a growing Session replaces its object
  // (ADR 0003), so a window measured from it is days since the last write and
  // a busy Session is kept forever. `seedArtifact` re-uploads every row it
  // writes, so this is really asserted by every case above — stated once here
  // because it is the anchor the ticket's window depends on.
  await sql`update orgs set retention_days = 30 where id = ${fixture.acme.id}`
  const old = await seedArtifact({ age: 400 })

  expect((await sweepRetention(sql)).removed).toBe(1)
  expect(bucket.deleted).toEqual([old])
})

test('an object no row names is deleted by the sweep', async () => {
  // What `POST /api/logs/confirm` records when it cannot delete the object a
  // Session left behind after its Project changed: the row has moved to the
  // new key, so nothing else could ever reach these bytes.
  await sql`
    insert into storage_orphans (storage_key)
    values ('orgs/a/members/b/projects/old/session-1.jsonl')
  `

  const swept = await sweepRetention(sql)

  // Not counted as removed — no transcript went — but the bytes are gone.
  expect(swept.removed).toBe(0)
  expect(bucket.deleted).toEqual([
    'orgs/a/members/b/projects/old/session-1.jsonl',
  ])
  expect(await sql`select storage_key from storage_orphans`).toHaveLength(0)
})

test('an orphan whose key a row names again is not deleted', async () => {
  // A key can come back: the whole-file key is reused by every pass, and a
  // chunk resealed with the same bytes lands on the same key. Deleting it
  // then would delete a transcript a row still points at.
  const live = await seedArtifact({ age: 1 })
  const [chunk] = await sealChunks(live, 1)
  await sql`
    insert into storage_orphans (storage_key)
    values (${live}), (${chunk!}), ('gone.jsonl')
  `

  await sweepRetention(sql)

  expect(bucket.deleted).toEqual(['gone.jsonl'])
})

test('a bucket that refuses keeps the orphan too', async () => {
  await sql`insert into storage_orphans (storage_key) values ('orphan.jsonl')`
  bucket.fails = true

  await expect(sweepRetention(sql)).rejects.toThrow(/refused/)

  // Rolled back with the rows: an orphan forgotten after a failed delete is
  // a transcript nothing can reach again.
  expect(await sql`select storage_key from storage_orphans`).toHaveLength(1)
})

test('a sweep already running is told there is more, not that it is done', async () => {
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })

  // Deterministic stand-in for the second of two overlapping sweeps: hold the
  // same advisory lock and call. Without the lock that sweep would choose its
  // rows from a snapshot still showing the first one's, delete fewer than it
  // selected, and read that as an empty backlog — stopping a drain that has
  // thousands left.
  const swept = await sql.begin(async (holder) => {
    await holder`
      select pg_advisory_xact_lock(hashtext('sessclone_retention_sweep'))
    `
    return sweepRetention(sql)
  })

  expect(swept).toEqual({ removed: 0, more: true })
  expect(bucket.deleted).toEqual([])
  // And the row is still there for the sweep that holds the lock.
  expect(await sql`select id from log_artifacts`).toHaveLength(1)
})

test('a sweep records that it ran, even when it removed nothing', async () => {
  expect(await sql`select * from retention_sweeps`).toHaveLength(0)

  await sweepRetention(sql)

  // "Has retention ever run here" is the question the settings page answers,
  // and a deployment with no scheduler promises a window nothing enforces.
  const [row] = await sql<{ removed: number }[]>`
    select removed from retention_sweeps
  `
  expect(row?.removed).toBe(0)

  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })
  await sweepRetention(sql)

  const rows = await sql<{ removed: number }[]>`
    select removed from retention_sweeps
  `
  // One row, replaced: a log of every sweep is a table nobody reads.
  expect(rows.map((one) => one.removed)).toEqual([1])
})

/** Gives an artifact `count` sealed chunks (ADR 0008), keyed beside it. */
const sealChunks = async (storageKey: string, count: number) => {
  const [artifact] = await sql<{ id: string; member_id: string }[]>`
    update log_artifacts
       set sealed_bytes = ${count * 1024}, sealed_sha256 = ${'c'.repeat(64)}
     where storage_key = ${storageKey}
    returning id, member_id
  `
  const keys = Array.from(
    { length: count },
    (_, index) =>
      `${storageKey}/chunks/${String(index + 1).padStart(6, '0')}.jsonl.gz`,
  )
  await sql`
    insert into log_artifact_chunks ${sql(
      keys.map((key, index) => ({
        artifact_id: artifact!.id,
        member_id: artifact!.member_id,
        seq: index + 1,
        raw_offset: index * 1024,
        raw_length: 1024,
        stored_bytes: 300,
        sha256: 'd'.repeat(64),
        storage_key: key,
      })),
    )}
  `
  return keys
}

const chunkCount = async () =>
  (
    await sql<
      { n: number }[]
    >`select count(*)::int as n from log_artifact_chunks`
  )[0]!.n

test('an expired chunked transcript takes every chunk with it, all at once', async () => {
  // Ticket 130: chunks never expire one by one — the age is the artifact's.
  await sql`update orgs set retention_days = 30 where id = ${fixture.acme.id}`
  const tail = await seedArtifact({ age: 31 })
  const chunks = await sealChunks(tail, 3)
  const kept = await seedArtifact({ age: 1 })
  const keptChunks = await sealChunks(kept, 1)

  expect(await sweepRetention(sql)).toEqual({ removed: 1, more: false })

  expect(bucket.deleted.toSorted()).toEqual([tail, ...chunks].toSorted())
  const left = await sql<{ storage_key: string }[]>`
    select storage_key from log_artifact_chunks
  `
  expect(left.map((row) => row.storage_key)).toEqual(keptChunks)
})

test('a bucket that refuses keeps the chunk rows as well as the artifact', async () => {
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  const tail = await seedArtifact({ age: 10 })
  await sealChunks(tail, 2)
  bucket.fails = true

  await expect(sweepRetention(sql)).rejects.toThrow(/refused/)

  expect(await sql`select id from log_artifacts`).toHaveLength(1)
  expect(await chunkCount()).toBe(2)
})

// ADR 0008: a key a presign signed and no confirm recorded — a pass cut off
// by its deadline, a crash, a lost confirm — expires out of the pending
// ledger into the sweep.

const pendingAt = (storageKey: string, expiresIn: number) => sql`
  insert into log_upload_pending
    (storage_key, pass, member_id, session_id, kind, expires_at)
  values (${storageKey}, '0000000000000000', ${fixture.acme.members.member},
          'session-1',
          'transcript', ${new Date(Date.now() + expiresIn)})
`

test('an expired pending upload is deleted; one still in time is kept', async () => {
  await pendingAt('lapsed/tail-1-0123456789abcdef.jsonl', -1000)
  await pendingAt('in-time/tail-1-0123456789abcdef.jsonl', 3_600_000)

  expect(await sweepRetention(sql)).toEqual({ removed: 0, more: false })

  expect(bucket.deleted).toEqual(['lapsed/tail-1-0123456789abcdef.jsonl'])
  const left = await sql<{ storage_key: string }[]>`
    select storage_key from log_upload_pending
  `
  expect(left.map((row) => row.storage_key)).toEqual([
    'in-time/tail-1-0123456789abcdef.jsonl',
  ])
})

test('an expired pending key a row names is not deleted', async () => {
  // The whole-file key is presigned by every zero-chunk pass, including one
  // whose confirm never came after an earlier one recorded it.
  const live = await seedArtifact({ age: 1 })
  await pendingAt(live, -1000)

  await sweepRetention(sql)

  expect(bucket.deleted).toEqual([])
})

test('a queued orphan a presign has signed again is kept while that upload is pending', async () => {
  await sql`insert into storage_orphans (storage_key) values ('again.jsonl')`
  await pendingAt('again.jsonl', 3_600_000)

  await sweepRetention(sql)

  expect(bucket.deleted).toEqual([])
})

test('lapsed keys already queued still count toward the limit', async () => {
  // A lapsed key can already sit in storage_orphans; the insert then skips
  // it, but the ledger row still went. Counting inserts read a full batch as
  // the end of the backlog.
  const live = await seedArtifact({ age: 1 })
  await sql`insert into storage_orphans (storage_key) values (${live})`
  await pendingAt(live, -2000)
  await pendingAt('later/tail-1-0123456789abcdef.jsonl', -1000)

  expect(await sweepRetention(sql, 1)).toEqual({ removed: 0, more: true })
})

test('a sweep racing a confirm that seals takes the new chunks too', async () => {
  // As the Member's deletes: the chunk rows commit while the sweep waits on
  // the artifact, and the statement runs once more on the 23503.
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  const tail = await seedArtifact({ age: 10 })
  const [artifact] = await sql<{ id: string }[]>`
    select id from log_artifacts where storage_key = ${tail}
  `
  let sweeping: ReturnType<typeof sweepRetention> | undefined
  await sql.begin(async (confirm) => {
    await confirm`
      insert into log_artifact_chunks ${confirm({
        artifact_id: artifact!.id,
        member_id: fixture.acme.members.member,
        seq: 1,
        raw_offset: 0,
        raw_length: 1024,
        stored_bytes: 300,
        sha256: 'd'.repeat(64),
        storage_key: `${tail}/chunks/000001-dddd.jsonl.gz`,
      })}
    `
    sweeping = sweepRetention(sql)
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- polling until it waits
      const [row] = await confirm<{ n: number }[]>`
        select count(*)::int as n from pg_locks where not granted
      `
      if (row!.n > 0) break
      // eslint-disable-next-line no-await-in-loop -- as above
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  })

  expect((await sweeping)?.removed).toBe(1)
  expect(await chunkCount()).toBe(0)
})

test('an Org’s contract ceiling (ticket 139) caps it before the Tier’s', async () => {
  await withTier(fixture.acme.id, null)
  await sql`
    update subscriptions set retention_max_days = 30 where org_id = ${fixture.acme.id}
  `
  await expect(
    sql`update orgs set retention_days = 31 where id = ${fixture.acme.id}`,
  ).rejects.toThrow(/ceiling of 30 days/)

  // An Org already past a ceiling agreed later is swept to it.
  await sql`
    update subscriptions set retention_max_days = null where org_id = ${fixture.acme.id}
  `
  await sql`update orgs set retention_days = 90 where id = ${fixture.acme.id}`
  await sql`
    update subscriptions set retention_max_days = 30 where org_id = ${fixture.acme.id}
  `
  const old = await seedArtifact({ age: 40 })
  const young = await seedArtifact({ age: 10 })
  await sweepRetention(sql)
  expect(bucket.deleted).toContain(old)
  expect(bucket.deleted).not.toContain(young)
})

test('moving to a Tier without transcripts keeps them seven days, then sweeps all', async () => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, base_price_usd, retention_max_days,
                       archival_available, sort_order)
    values ('no-transcripts', 'Personal', 5, 90, false, 1) returning id
  `
  await withTier(fixture.acme.id, 90)
  await sql`
    update subscriptions set tier_id = ${tier!.id} where org_id = ${fixture.acme.id}
  `
  const recent = await seedArtifact({ age: 1 })
  await sweepRetention(sql)
  expect(bucket.deleted).not.toContain(recent)
  // The Transcripts page names the same day the sweep acts on.
  const ends = await asRole(fixture.acme, 'member', (tx) =>
    transcriptsEndOn(tx, fixture.acme.id),
  )
  expect(ends?.passed).toBe(false)
  expect(ends!.on.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000)

  // Eight days on from the change.
  await sql`
    update subscription_events set occurred_at = now() - interval '8 days'
     where org_id = ${fixture.acme.id}
  `
  expect(
    (
      await asRole(fixture.acme, 'member', (tx) =>
        transcriptsEndOn(tx, fixture.acme.id),
      )
    )?.passed,
  ).toBe(true)
  await sweepRetention(sql)
  expect(bucket.deleted).toContain(recent)
})

test('an edit after the move to a Tier without transcripts does not restart the seven days', async () => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, base_price_usd, retention_max_days,
                       archival_available, sort_order)
    values ('no-transcripts-2', 'Personal', 5, 90, false, 1) returning id
  `
  await withTier(fixture.acme.id, 90)
  await sql`
    update subscriptions set tier_id = ${tier!.id} where org_id = ${fixture.acme.id}
  `
  const recent = await seedArtifact({ age: 1 })
  await sql`
    update subscription_events set occurred_at = now() - interval '8 days'
     where org_id = ${fixture.acme.id}
  `
  // A price agreed today writes an event of its own.
  await sql`
    update subscriptions set price_base_cents = 500 where org_id = ${fixture.acme.id}
  `
  await sweepRetention(sql)
  expect(bucket.deleted).toContain(recent)
})

test('a lower ceiling brings the Org’s own setting down with it', async () => {
  await withTier(fixture.acme.id, 365)
  await sql`update orgs set retention_days = 300 where id = ${fixture.acme.id}`
  await sql`
    update subscriptions set retention_max_days = 30 where org_id = ${fixture.acme.id}
  `
  const [org] =
    await sql`select retention_days from orgs where id = ${fixture.acme.id}`
  expect(org!.retention_days).toBe(30)
})

test('account deletions that cannot run never stop the sweep', async () => {
  process.env.RETENTION_SWEEP_SECRET = 'a-real-secret'
  await sql`update orgs set retention_days = 1 where id = ${fixture.acme.id}`
  await seedArtifact({ age: 10 })
  // The queue's first read fails.
  await sql`alter function sessclone_deletion_blockers(uuid) rename to blockers_gone`
  try {
    expect(await (await sweep('a-real-secret')).json()).toEqual({
      removed: 1,
      remaining: 0,
      accounts: { error: 'account deletions did not run' },
    })
  } finally {
    await sql`alter function blockers_gone(uuid) rename to sessclone_deletion_blockers`
    delete process.env.RETENTION_SWEEP_SECRET
  }
})
