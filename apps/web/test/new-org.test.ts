import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  createOwnOrg,
  PendingOrgExists,
  type NewOrg,
} from '../lib/auth/bootstrap'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 136: "New Org" in the Org switcher. Run as `sessclone_app` through
// `asUser`, so the policies that let sign-in create an Org are the ones that
// let this one, and the pending check reads only what the person may read.

const TIER_SEED = new URL(
  '../../../supabase/migrations/20260922050000_tier_seed.sql',
  import.meta.url,
)

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(TIER_SEED, 'utf8'))
  await sql`
    update tiers set features = features || '{"self_serve": true}'
     where key in ('personal', 'team')
  `
  vi.stubEnv('SIGNUP_APPROVAL', 'on')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const TEAM: NewOrg = {
  name: 'Side Project',
  plan: { tierKey: 'team', seats: 3 },
}

const create = (userId: string, org: NewOrg = TEAM) =>
  asUser(userId, (tx) => createOwnOrg(tx, userId, org))

/** What `create` raised, or null when it created the Org. */
const refusal = (attempt: Promise<unknown>) =>
  attempt.then(
    () => null,
    (error: unknown) => error,
  )

const setStatus = (orgId: string, status: string) =>
  sql`
    insert into subscriptions (org_id, tier_id, status)
    select ${orgId}, id, ${status}::subscription_status from tiers
     where key = 'team'
    on conflict (org_id) do update set status = excluded.status
  `

const ownedBy = (userId: string) =>
  sql<{ name: string; role: string; status: string | null }[]>`
    select org.name, member.role, subscription.status
      from members member
      join orgs org on org.id = member.org_id
      left join subscriptions subscription on subscription.org_id = org.id
     where member.user_id = ${userId}
     order by member.created_at
  `

test('makes the person its Owner, with the plan asked for waiting on the operator', async () => {
  // Acme's Owner, with Acme approved, starts a second Org.
  await setStatus(fixture.acme.id, 'active')
  const made = await create(fixture.acme.users.owner)

  const [row] = await sql<
    { name: string; role: string; status: string; key: string; seats: number }[]
  >`
    select org.name, member.role, subscription.status, tier.key,
           subscription.requested_seats as seats
      from members member
      join orgs org on org.id = member.org_id
      join subscriptions subscription on subscription.org_id = org.id
      join tiers tier on tier.id = subscription.tier_id
     where member.id = ${made.memberId}
  `
  expect(row).toEqual({
    name: 'Side Project',
    role: 'owner',
    status: 'inactive',
    key: 'team',
    seats: 3,
  })
})

test('refuses a second Org while one the person owns waits for approval', async () => {
  // Acme has no subscription row: it is waiting, and Acme's Owner owns it.
  const error = await refusal(create(fixture.acme.users.owner))

  expect(error).toBeInstanceOf(PendingOrgExists)
  expect(await ownedBy(fixture.acme.users.owner)).toHaveLength(1)
})

test('counts only Orgs the person owns, and not cancelled ones', async () => {
  // Acme's Member is in a waiting Org, but it is not theirs.
  expect(await refusal(create(fixture.acme.users.member))).toBeNull()

  // Acme cancelled: not waiting, so its Owner may start another.
  await setStatus(fixture.acme.id, 'cancelled')
  expect(await refusal(create(fixture.acme.users.owner))).toBeNull()
  // Which now waits, so a third is refused.
  expect(await refusal(create(fixture.acme.users.owner))).toBeInstanceOf(
    PendingOrgExists,
  )
})

test('any number of approved Orgs, and no plan or limit with approval off', async () => {
  await setStatus(fixture.acme.id, 'active')
  const first = await create(fixture.acme.users.owner)
  await setStatus(first.orgId, 'active')
  expect(await refusal(create(fixture.acme.users.owner))).toBeNull()

  // Switched off, nothing waits, so nothing is asked for and nothing limits.
  vi.stubEnv('SIGNUP_APPROVAL', 'off')
  const plain = { name: 'Plain', plan: null }
  await create(fixture.globex.users.owner, plain)
  await create(fixture.globex.users.owner, plain)
  const globex = await ownedBy(fixture.globex.users.owner)
  expect(globex.map((org) => [org.name, org.status])).toEqual([
    ['Globex', null],
    ['Plain', null],
    ['Plain', null],
  ])
})

test('two submits at once create one waiting Org, not two', async () => {
  await setStatus(fixture.acme.id, 'active')
  // Each transaction holds its Org uncommitted until the other has had its
  // turn, or half a second has passed: without the lock both pass the check
  // before either commits, which is the interleaving that matters. With it,
  // the second waits on the first and then sees its Org.
  let release!: () => void
  const both = new Promise<void>((resolve) => (release = resolve))
  let ran = 0
  const submit = () =>
    refusal(
      asUser(fixture.acme.users.owner, async (tx) => {
        await createOwnOrg(tx, fixture.acme.users.owner, TEAM)
        if (++ran === 2) release()
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          both,
          new Promise((resolve) => (timer = setTimeout(resolve, 500))),
        ])
        clearTimeout(timer)
      }),
    )

  const results = await Promise.all([submit(), submit()])

  expect(results.filter((result) => result === null)).toHaveLength(1)
  expect(results.find((result) => result !== null)).toBeInstanceOf(
    PendingOrgExists,
  )
  expect(await ownedBy(fixture.acme.users.owner)).toHaveLength(2)
})
