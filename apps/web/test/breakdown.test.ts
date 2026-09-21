import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, test } from 'vitest'

import { breakdown, BREAKDOWN_LIMIT } from '../lib/breakdown'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Tickets 54, 55 and 56. What each of them adds over ticket 52 is a grouping
// and a name, so what is proven here is the part that is easy to get quietly
// wrong: who sees which rows, and what happens to a Turn whose Member,
// Project or Device is not readable — or not there at all.

const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

const MILLION = 1_000_000
const september = { from: '2026-09-01', to: '2026-10-01' }

let fixture: Fixture
let nextMessage = 0

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(SEED, 'utf8'))
  nextMessage = 0
})

const seedTurn = async (over: Record<string, unknown> = {}) => {
  nextMessage += 1
  await sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: 'session-1',
      message_id: `msg_${nextMessage}`,
      occurred_at: '2026-09-20T08:00:00Z',
      model: 'claude-opus-4-6',
      input_tokens: MILLION,
      ...over,
    })}
  `
}

const project = async (key: string, remote: string | null = null) => {
  const [row] = await sql<{ id: string }[]>`
    insert into projects (org_id, key, remote)
    values (${fixture.acme.id}, ${key}, ${remote}) returning id
  `
  return row!.id
}

const device = async (
  memberId: string,
  key: string,
  nickname: string | null = null,
) => {
  const [row] = await sql<{ id: string }[]>`
    insert into devices (member_id, key, nickname)
    values (${memberId}, ${key}, ${nickname}) returning id
  `
  return row!.id
}

describe('per Member (54)', () => {
  test('costs and tokens per person, largest first', async () => {
    await seedTurn({ member_id: fixture.acme.members.owner })
    await seedTurn({ member_id: fixture.acme.members.owner })
    await seedTurn({ member_id: fixture.acme.members.member })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'members').then(
        (result) => result.rows,
      ),
    )

    expect(rows.map((row) => [row.turns, row.costUsd])).toEqual([
      [2, 10],
      [1, 5],
    ])
    expect(rows[0]!.tokens).toBe(2 * MILLION)
  })

  test('a Member sees only themselves, through the policy', async () => {
    await seedTurn({ member_id: fixture.acme.members.owner })
    await seedTurn({ member_id: fixture.acme.members.member })

    const rows = await asRole(fixture.acme, 'member', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'members').then(
        (result) => result.rows,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(fixture.acme.members.member)
  })

  test('a Manager sees their Scope and nobody else', async () => {
    await seedTurn({ member_id: fixture.acme.members.owner })
    await seedTurn({ member_id: fixture.acme.members.member })

    const rows = await asRole(fixture.acme, 'manager', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'members').then(
        (result) => result.rows,
      ),
    )

    // The fixture's Scope holds the Member and not the Owner.
    expect(rows.map((row) => row.id)).toEqual([fixture.acme.members.member])
  })

  test('a removed Member still appears, marked', async () => {
    // Their spend is in the range whether or not they are still in the Org,
    // and a historical total that dropped them would not add up.
    await seedTurn({ member_id: fixture.acme.members.removed })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'members').then(
        (result) => result.rows,
      ),
    )

    expect(rows[0]!.note).toBe('removed')
    expect(rows[0]!.costUsd).toBe(5)
  })

  test('an unpriced Turn is counted in its row, never added to it', async () => {
    await seedTurn()
    await seedTurn({ model: 'claude-unreleased-9' })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'members').then(
        (result) => result.rows,
      ),
    )

    expect(rows[0]).toMatchObject({ costUsd: 5, turns: 2, unpricedTurns: 1 })
  })
})

describe('per Project (55)', () => {
  test('one repository reported from two machines is one row', async () => {
    // The Project key is the normalised remote (ticket 33), so two machines
    // that cloned the same repository report the same key and land on the
    // same row. Nothing here dedupes; the identity does.
    const repo = await project(
      'github.com/acme/api',
      'git@github.com:acme/api.git',
    )
    await seedTurn({ project_id: repo, device_id: null })
    await seedTurn({ project_id: repo, device_id: null })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'projects').then(
        (result) => result.rows,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: 'github.com/acme/api', turns: 2 })

    // And it is one row because the identity says so, not because the test
    // pointed both Turns at one row: the second machine reporting the same
    // remote resolves to the same Project.
    await expect(
      project('github.com/acme/api', 'https://github.com/acme/api'),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  test('work with no repository is attributed, not dropped', async () => {
    const scratch = await project('local:laptop:/tmp/spike')
    await seedTurn({ project_id: scratch })
    await seedTurn({ project_id: null })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'projects').then(
        (result) => result.rows,
      ),
    )

    expect(rows.map((row) => row.label).toSorted()).toEqual([
      'No project reported',
      'local:laptop:/tmp/spike',
    ])
    expect(rows.reduce((sum, row) => sum + row.turns, 0)).toBe(2)
  })

  test('a Member sees their own work only', async () => {
    const repo = await project('github.com/acme/api')
    await seedTurn({ project_id: repo, member_id: fixture.acme.members.owner })

    const rows = await asRole(fixture.acme, 'member', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'projects').then(
        (result) => result.rows,
      ),
    )

    expect(rows).toEqual([])
  })
})

describe('per Device (56)', () => {
  test('a nickname is shown, with the key beside it', async () => {
    const id = await device(
      fixture.acme.members.member,
      'host:thinkpad',
      'work laptop',
    )
    await seedTurn({ device_id: id })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'devices').then(
        (result) => result.rows,
      ),
    )

    expect(rows[0]).toMatchObject({
      label: 'work laptop',
      note: 'host:thinkpad',
    })
  })

  test('a Device with no nickname is its key', async () => {
    const id = await device(fixture.acme.members.member, 'host:thinkpad')
    await seedTurn({ device_id: id })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'devices').then(
        (result) => result.rows,
      ),
    )

    expect(rows[0]).toMatchObject({ label: 'host:thinkpad', note: null })
  })

  test('every cloud container is one Device per Member', async () => {
    // `deviceKey` keys a cloud session on the account rather than the
    // container (ADR 0001, finding on ticket 05), so a hundred containers
    // report one key and the unique index on (member, key) keeps it one row.
    const id = await device(fixture.acme.members.member, 'cloud:acct-1:web')
    await seedTurn({ device_id: id })
    await seedTurn({ device_id: id })
    await seedTurn({ device_id: id })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'devices').then(
        (result) => result.rows,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: 'cloud:acct-1:web', turns: 3 })

    // One row because `(member_id, key)` is unique, not because the seed only
    // made one: the hundred-and-first container reports the same key.
    await expect(
      device(fixture.acme.members.member, 'cloud:acct-1:web'),
    ).rejects.toThrow(/duplicate key|unique/i)
  })

  test('a Turn with no Device is named rather than dropped', async () => {
    await seedTurn({ device_id: null })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, 'devices').then(
        (result) => result.rows,
      ),
    )

    expect(rows[0]!.label).toBe('No device reported')
  })
})

test('another Org sees nothing, whatever id is passed', async () => {
  await seedTurn()

  const reads = (['members', 'projects', 'devices'] as const).map((dimension) =>
    asRole(fixture.globex, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, 'UTC', september, dimension).then(
        (result) => result.rows,
      ),
    ),
  )

  for (const rows of await Promise.all(reads)) expect(rows).toEqual([])
})

test('the range is half-open, in the Org timezone', async () => {
  await sql`update orgs set timezone = 'Asia/Karachi' where id = ${fixture.acme.id}`
  // 20:00 UTC on 30 September is 01:00 on 1 October in Karachi, which is
  // outside a September range measured the Org's way.
  await seedTurn({ occurred_at: '2026-09-30T20:00:00Z' })

  const rows = await asRole(fixture.acme, 'owner', (tx) =>
    breakdown(tx, fixture.acme.id, 'Asia/Karachi', september, 'members').then(
      (result) => result.rows,
    ),
  )

  expect(rows).toEqual([])

  // The positive control: an hour earlier is inside, so the empty answer above
  // is the boundary and not a dropped join or a wrong Org.
  await seedTurn({ occurred_at: '2026-09-30T18:00:00Z' })
  const inside = await asRole(fixture.acme, 'owner', (tx) =>
    breakdown(tx, fixture.acme.id, 'Asia/Karachi', september, 'members').then(
      (result) => result.rows,
    ),
  )
  expect(inside).toHaveLength(1)
})

test('a group with nothing priced reads as unknown, never as zero', async () => {
  await seedTurn({ model: 'claude-unreleased-9' })

  const { rows, totals } = await asRole(fixture.acme, 'owner', (tx) =>
    breakdown(tx, fixture.acme.id, 'UTC', september, 'members'),
  )

  // ADR 0002: unpriced resolves to null, and a null that becomes 0 on the way
  // to the page is a figure that understates while looking authoritative.
  expect(rows[0]!.costUsd).toBeNull()
  expect(rows[0]).toMatchObject({ turns: 1, unpricedTurns: 1 })
  expect(totals.costUsd).toBe(0)
  expect(totals.unpricedTurns).toBe(1)
})

test('the list is capped, and the totals still count what it left out', async () => {
  const devices = await Promise.all(
    Array.from({ length: BREAKDOWN_LIMIT + 2 }, (_, index) =>
      device(fixture.acme.members.member, `host:box-${index}`),
    ),
  )
  await Promise.all(devices.map((id) => seedTurn({ device_id: id })))

  const { rows, totals, more } = await asRole(fixture.acme, 'owner', (tx) =>
    breakdown(tx, fixture.acme.id, 'UTC', september, 'devices'),
  )

  expect(rows).toHaveLength(BREAKDOWN_LIMIT)
  expect(more).toBe(2)
  expect(totals.turns).toBe(BREAKDOWN_LIMIT + 2)
  expect(totals.costUsd).toBe(5 * (BREAKDOWN_LIMIT + 2))
})
