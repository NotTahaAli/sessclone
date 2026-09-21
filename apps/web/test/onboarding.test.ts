import { beforeEach, expect, test } from 'vitest'

import { onboardingFacts, onboardingState } from '../lib/onboarding'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 45: the three observed facts behind the Costs surface, and the state
// they put it in.
//
// Against a real Postgres, because two of the three facts are answered by a
// policy rather than by the query — `api_keys_own` narrows a person to their
// own keys, `turns_read` narrows a Member to their own Turns and a Manager to
// their Scope — and a test on a mock would prove only that the mock agrees
// with itself.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const seedKey = async (memberId: string, used: boolean) =>
  sql`
    insert into api_keys (member_id, label, key_hash, key_prefix, last_used_at)
    values (
      ${memberId}, 'laptop', ${`hash_${memberId}_${used}`}, 'sk_abcdefgh',
      ${used ? new Date() : null}::timestamptz
    )
  `

let nextMessage = 0

const seedTurn = async (orgId: string, memberId: string) => {
  nextMessage += 1
  await sql`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at)
    values (
      ${orgId}, ${memberId}, 'session-1', ${`msg_${nextMessage}`},
      '2026-09-20T08:00:00Z'
    )
  `
}

const factsFor = (org: Fixture['acme'], role: Parameters<typeof asRole>[1]) =>
  asRole(org, role, (tx) => onboardingFacts(tx, org.id))

test('an Owner whose Org is collecting is not asked to create a key', async () => {
  // The failure this ordering exists for. `api_keys_own` shows the Owner only
  // his *own* keys, and he has none: his four engineers are the ones running
  // Collectors. Asked about the key first, he was told "you have no API key
  // yet" on an Org with a week of Turns in it.
  await seedKey(fixture.acme.members.member, true)
  await seedTurn(fixture.acme.id, fixture.acme.members.member)

  const facts = await factsFor(fixture.acme, 'owner')

  expect(facts.has_key).toBe(false)
  expect(facts.any_turns).toBe(true)
  expect(onboardingState(facts)).toBe('collecting')
})

test('another Org collecting does not make this one look collected', async () => {
  // The policies scope to the person, not to one Org, so somebody in two Orgs
  // sees both Orgs' Turns. Acme has none of its own.
  // Their own membership in the other Org, and their own Turn under it, so
  // the Turn is visible to them under any Role rather than by way of a Scope.
  const [second] = await sql<{ id: string }[]>`
    insert into members (org_id, user_id, role)
    values (
      ${fixture.globex.id}, ${fixture.acme.users.owner}, 'member'::member_role
    )
    returning id
  `
  await seedTurn(fixture.globex.id, second!.id)

  expect((await factsFor(fixture.acme, 'owner')).any_turns).toBe(false)
  expect((await factsFor(fixture.globex, 'owner')).any_turns).toBe(true)
})

test('a Manager sees a Turn inside their Scope and not one outside it', async () => {
  await seedTurn(fixture.acme.id, fixture.acme.members.member)

  // `manager` has the Member in Scope; `managerWithoutScope` has nobody.
  expect((await factsFor(fixture.acme, 'manager')).any_turns).toBe(true)
  expect((await factsFor(fixture.acme, 'managerWithoutScope')).any_turns).toBe(
    false,
  )
})

test('a key that has been used and has landed no Turn is its own state', async () => {
  await seedKey(fixture.acme.members.member, true)

  const facts = await factsFor(fixture.acme, 'member')

  expect(facts).toMatchObject({
    has_key: true,
    key_used: true,
    any_turns: false,
  })
  expect(onboardingState(facts)).toBe('waiting')
})

test('a fresh Org with nothing at all is the day-one state', async () => {
  const facts = await factsFor(fixture.acme, 'owner')

  expect(facts).toMatchObject({
    has_key: false,
    key_used: false,
    any_turns: false,
  })
  expect(onboardingState(facts)).toBe('no-key')
})
