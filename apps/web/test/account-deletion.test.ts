import { beforeEach, expect, test } from 'vitest'

import { hashApiKey } from '../lib/api-keys'
import { resolveCaller } from '../lib/collector-auth'
import { leaveOrg } from '../lib/members'
import {
  cancelOwnDeletion,
  finalizeDueDeletions,
  ownDeletionBlockers,
  requestOwnDeletion,
  signInIsFresh,
  stuckDeletions,
} from '../lib/account-deletion'
import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'

// Ticket 141: deleting your own account, against the real migrations.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

/** Moves a request back past its grace. */
const ageRequest = async (userId: string, days = 15) => {
  await sql.begin(async (tx) => {
    await tx`select set_config('sessclone.account_deletion', 'on', true)`
    await tx`
      update users set deletion_requested_at = now() - ${`${days} days`}::interval
       where id = ${userId}
    `
  })
}

const signInGone: string[] = []
const removeSignIn = async (id: string) => {
  signInGone.push(id)
}

test('a sign-in is fresh for ten minutes, by its newest amr stamp', () => {
  const now = new Date('2026-09-25T12:00:00Z')
  const at = (minutesAgo: number) => now.getTime() / 1000 - minutesAgo * 60
  expect(
    signInIsFresh({ amr: [{ method: 'oauth', timestamp: at(9) }] }, now),
  ).toBe(true)
  expect(
    signInIsFresh({ amr: [{ method: 'oauth', timestamp: at(11) }] }, now),
  ).toBe(false)
  expect(
    signInIsFresh(
      {
        amr: [
          { method: 'otp', timestamp: at(30) },
          { method: 'oauth', timestamp: at(2) },
        ],
      },
      now,
    ),
  ).toBe(true)
  expect(signInIsFresh({}, now)).toBe(false)
  expect(signInIsFresh({ amr: 'nope' }, now)).toBe(false)
})

test('the sole Owner of an Org with other Members is refused and told which', async () => {
  const blockers = await asRole(fixture.acme, 'owner', ownDeletionBlockers)
  expect(blockers.map((row) => row.org_name)).toEqual(['Acme'])
  await expect(
    asRole(fixture.acme, 'owner', requestOwnDeletion),
  ).rejects.toThrow(/hand over ownership first/)
})

test('a second Owner unblocks the first', async () => {
  await asRole(
    fixture.acme,
    'owner',
    (tx) =>
      tx`update members set role = 'owner' where id = ${fixture.acme.members.admin}`,
  )
  expect(await asRole(fixture.acme, 'owner', ownDeletionBlockers)).toEqual([])
  const requested = await asRole(fixture.acme, 'owner', requestOwnDeletion)
  expect(requested).toBeInstanceOf(Date)
})

test('a person cannot set the deletion columns on their own row', async () => {
  await expect(
    asRole(
      fixture.acme,
      'member',
      (tx) =>
        tx`update users set deleted_at = now() where id = ${fixture.acme.users.member}`,
    ),
  ).rejects.toThrow(/account deletion goes through its own functions/)
  await expect(
    asRole(
      fixture.acme,
      'member',
      (tx) =>
        tx`update users set deletion_requested_at = now() - interval '30 days'
          where id = ${fixture.acme.users.member}`,
    ),
  ).rejects.toThrow(/account deletion goes through its own functions/)
})

test('setting the deletion flag by hand does not open the columns', async () => {
  await expect(
    asRole(fixture.acme, 'member', async (tx) => {
      await tx`select set_config('sessclone.account_deletion', 'on', true)`
      await tx`update users set deleted_at = now() where id = ${fixture.acme.users.member}`
    }),
  ).rejects.toThrow(/account deletion goes through its own functions/)
})

test('Keep my account undoes the request', async () => {
  await asRole(fixture.acme, 'member', requestOwnDeletion)
  await asRole(fixture.acme, 'member', cancelOwnDeletion)
  const [row] = await sql`
    select deletion_requested_at from users where id = ${fixture.acme.users.member}
  `
  expect(row!.deletion_requested_at).toBeNull()
})

test('ingest refuses the keys of a person in their grace, and takes them back on Keep', async () => {
  await sql`
    insert into api_keys (member_id, label, key_hash, key_prefix)
    values (${fixture.acme.members.member}, 'k', ${hashApiKey('sc_grace_key')}, 'sc_grace')
  `
  expect(await resolveCaller(sql, 'sc_grace_key')).toBeDefined()
  await asRole(fixture.acme, 'member', requestOwnDeletion)
  expect(await resolveCaller(sql, 'sc_grace_key')).toBeUndefined()
  await asRole(fixture.acme, 'member', cancelOwnDeletion)
  expect(await resolveCaller(sql, 'sc_grace_key')).toBeDefined()
})

test('the dashboard role may not finalize anybody', async () => {
  await expect(
    asUser(
      fixture.acme.users.member,
      (tx) =>
        tx`select sessclone_finalize_account_deletion(${fixture.acme.users.member})`,
    ),
  ).rejects.toThrow(/permission denied/)
})

test('nothing happens inside the grace', async () => {
  await asRole(fixture.acme, 'member', requestOwnDeletion)
  await ageRequest(fixture.acme.users.member, 13)
  signInGone.length = 0
  expect(await finalizeDueDeletions(sql, removeSignIn)).toEqual({
    scrubbed: 0,
    signInsRemoved: 0,
    failed: [],
  })
})

test('after the grace a person is scrubbed; Turns stay under a stable label', async () => {
  const person = fixture.acme.users.member
  const member = fixture.acme.members.member
  await sql`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at)
    values (${fixture.acme.id}, ${member}, 's1', 'm1', now())
  `
  await sql`
    insert into api_keys (member_id, label, key_hash, key_prefix)
    values (${member}, 'k', ${'h'.repeat(64)}, 'sk_live')
  `
  await sql`
    insert into log_artifacts ${sql({
      org_id: fixture.acme.id,
      member_id: member,
      session_id: 's1',
      storage_key: 'orgs/a/members/m/s1.jsonl',
      sha256: 'a'.repeat(64),
      size_bytes: 1,
    })}
  `

  await asUser(person, requestOwnDeletion)
  await ageRequest(person)
  signInGone.length = 0
  const result = await finalizeDueDeletions(sql, removeSignIn)
  expect(result).toEqual({ scrubbed: 1, signInsRemoved: 1, failed: [] })
  expect(signInGone).toEqual([person])

  const [user] = await sql`
    select display_name, email, deleted_at, deletion_requested_at
      from users where id = ${person}
  `
  expect(user!.display_name).toMatch(/^Deleted person · [0-9a-f]{4}$/)
  expect(user!.email).toMatch(/@deleted\.invalid$/)
  expect(user!.email).not.toContain('acme')
  expect(user!.deleted_at).not.toBeNull()
  expect(user!.deletion_requested_at).toBeNull()

  // The Turn stays, and a colleague's read names it by the label.
  const turns = await sql`select 1 from turns where member_id = ${member}`
  expect(turns).toHaveLength(1)

  const [membership] =
    await sql`select removed_at from members where id = ${member}`
  expect(membership!.removed_at).not.toBeNull()
  const live = await sql`
    select 1 from api_keys where member_id = ${member} and revoked_at is null
  `
  expect(live).toHaveLength(0)
  expect(
    await sql`select 1 from log_artifacts where member_id = ${member}`,
  ).toHaveLength(0)
  expect(
    await sql`select 1 from storage_orphans where storage_key = 'orgs/a/members/m/s1.jsonl'`,
  ).toHaveLength(1)

  // The Org still exists and still has its Owner.
  const [subscriptionCount] = await sql`
    select count(*)::int as n from members
     where org_id = ${fixture.acme.id} and role = 'owner' and removed_at is null
  `
  expect(subscriptionCount!.n).toBe(1)
})

const soloOrg = async () => {
  const [org] = await sql<{ id: string }[]>`
    insert into orgs (name) values ('Solo') returning id
  `
  const [row] = await sql<{ id: string; member: string }[]>`
    with u as (insert into users (email) values ('solo@solo.test') returning id)
    insert into members (org_id, user_id, role)
    select ${org!.id}, u.id, 'owner' from u returning user_id as id, id as member
  `
  return { org: org!.id, user: row!.id, member: row!.member }
}

test('a sole Owner still cannot leave by hand; only a deletion takes them', async () => {
  const solo = await soloOrg()
  await expect(
    asUser(solo.user, (tx) => leaveOrg(tx, solo.member)),
  ).rejects.toThrow(/at least one owner/)
})

test('a sole Member closes their Org with them', async () => {
  const [org] = await sql<{ id: string }[]>`
    insert into orgs (name) values ('Solo') returning id
  `
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, base_price_usd, sort_order)
    values ('solo-tier', 'Personal', 5, 1) returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${org!.id}, ${tier!.id}, 'active')
  `
  const [user] = await sql<{ id: string }[]>`
    with u as (insert into users (email) values ('solo@solo.test') returning id)
    insert into members (org_id, user_id, role)
    select ${org!.id}, u.id, 'owner' from u returning user_id as id
  `
  await asUser(user!.id, requestOwnDeletion)
  await ageRequest(user!.id)
  await finalizeDueDeletions(sql, removeSignIn)

  const [subscription] = await sql`
    select status from subscriptions where org_id = ${org!.id}
  `
  expect(subscription!.status).toBe('cancelled')
  const live = await sql`
    select 1 from members where org_id = ${org!.id} and removed_at is null
  `
  expect(live).toHaveLength(0)
})

test('a failed sign-in removal is retried and listed', async () => {
  const person = fixture.acme.users.member
  await asUser(person, requestOwnDeletion)
  await ageRequest(person)
  const first = await finalizeDueDeletions(sql, async () => {
    throw new Error('no service role key')
  })
  expect(first).toEqual({ scrubbed: 1, signInsRemoved: 0, failed: [person] })
  expect((await stuckDeletions(sql)).map((row) => row.id)).toEqual([person])

  const second = await finalizeDueDeletions(sql, removeSignIn)
  expect(second).toEqual({ scrubbed: 0, signInsRemoved: 1, failed: [] })
  expect(await stuckDeletions(sql)).toEqual([])
})

test('someone who became a blocking sole Owner during the grace waits', async () => {
  const person = fixture.acme.users.member
  await asUser(person, requestOwnDeletion)
  await ageRequest(person)
  // Promoted during the grace, and the old Owner stepped down.
  await asRole(fixture.acme, 'owner', async (tx) => {
    await tx`update members set role = 'owner' where id = ${fixture.acme.members.member}`
    await tx`update members set role = 'admin' where id = ${fixture.acme.members.owner}`
  })
  expect(await finalizeDueDeletions(sql, removeSignIn)).toEqual({
    scrubbed: 0,
    signInsRemoved: 0,
    failed: [],
  })
})
