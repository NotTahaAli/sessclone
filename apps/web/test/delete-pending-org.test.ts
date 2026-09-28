import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import { deletePendingOrg } from '../lib/org'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Deleting an Org still waiting for approval: its Owner or a platform admin,
// never anybody else, never an approved Org, never one with history. Run as
// `sessclone_app` through `asUser`, so the grant is what is under test.

const TIER_SEED = new URL(
  '../../../supabase/migrations/20260922050000_tier_seed.sql',
  import.meta.url,
)

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(TIER_SEED, 'utf8'))
})

const remove = (userId: string, orgId = fixture.acme.id) =>
  asUser(userId, (tx) => deletePendingOrg(tx, orgId))

const exists = async (orgId = fixture.acme.id) => {
  const [row] = await sql`select 1 from orgs where id = ${orgId}`
  return row !== undefined
}

const setStatus = (status: string, orgId = fixture.acme.id) =>
  sql`
    insert into subscriptions (org_id, tier_id, status)
    select ${orgId}, id, ${status}::subscription_status from tiers
     where key = 'team'
  `

test('its Owner deletes an Org with no subscription row, memberships and all', async () => {
  expect(await remove(fixture.acme.users.owner)).toBe('deleted')
  expect(await exists()).toBe(false)
  const members = await sql`
    select 1 from members where org_id = ${fixture.acme.id}
  `
  expect(members).toHaveLength(0)
  expect(await exists(fixture.globex.id)).toBe(true)
})

test('its Owner deletes an inactive Org, and the plan it asked for goes too', async () => {
  await setStatus('inactive')
  expect(await remove(fixture.acme.users.owner)).toBe('deleted')
  const rows = await sql`
    select 1 from subscriptions where org_id = ${fixture.acme.id}
  `
  expect(rows).toHaveLength(0)
})

test('a platform admin deletes a waiting Org they are not in', async () => {
  expect(await remove(fixture.platformAdmin.userId)).toBe('deleted')
  expect(await exists()).toBe(false)
})

test('nobody but an Owner or a platform admin can', async () => {
  for (const userId of [
    fixture.acme.users.admin,
    fixture.acme.users.member,
    fixture.acme.users.removed,
    fixture.globex.users.owner,
    fixture.stranger.userId,
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal at a time.
    expect(await remove(userId)).toBe('forbidden')
  }
  expect(await exists()).toBe(true)
})

test('an Owner in their deletion grace cannot', async () => {
  await sql.begin(async (tx) => {
    await tx`select set_config('sessclone.account_deletion', 'on', true)`
    await tx`
      update users set deletion_requested_at = now()
       where id = ${fixture.acme.users.owner}
    `
  })
  expect(await remove(fixture.acme.users.owner)).toBe('forbidden')
  expect(await exists()).toBe(true)
})

test('an approved or cancelled Org stays', async () => {
  for (const status of ['active', 'past_due', 'cancelled']) {
    // oxlint-disable-next-line no-await-in-loop -- one status at a time.
    await sql`delete from subscriptions where org_id = ${fixture.acme.id}`
    // oxlint-disable-next-line no-await-in-loop -- one status at a time.
    await setStatus(status)
    // oxlint-disable-next-line no-await-in-loop -- one status at a time.
    expect(await remove(fixture.acme.users.owner)).toBe('approved')
  }
  expect(await remove(fixture.platformAdmin.userId)).toBe('approved')
  expect(await exists()).toBe(true)
})

test('an inactive Org that already ran keeps its history', async () => {
  await setStatus('inactive')
  await sql`
    insert into devices (member_id, key)
    values (${fixture.acme.members.member}, 'laptop')
  `
  expect(await remove(fixture.acme.users.owner)).toBe('history')
  expect(await exists()).toBe(true)
})

test('an Org that does not exist answers like one that is not yours', async () => {
  expect(await remove(fixture.platformAdmin.userId, crypto.randomUUID())).toBe(
    'forbidden',
  )
})
