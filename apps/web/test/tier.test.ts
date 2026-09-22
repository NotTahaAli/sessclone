import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import { isActive, orgTier, retentionCeiling } from '../lib/tier'
import { tierPrice, tierSeats } from '../lib/tiers'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 47: the Tier the Org is on, what it includes, and what it does not.
//
// The last criterion is the one the tests here are shaped around — capabilities
// are read from Tier data, so a change needs no deployment. Every assertion
// therefore changes a row and expects the answer to move, rather than
// expecting a Tier key to mean something.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

/** A Tier row, and the Org's subscription to it. */
const seedTier = async (
  over: Record<string, unknown> = {},
  status = 'active',
  org = () => fixture.acme.id,
) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers ${sql({
      key: 'team',
      name: 'Team',
      description: 'A team that wants one number for all of it.',
      seat_price_usd: 10,
      min_seats: 2,
      max_seats: 10,
      retention_max_days: 365,
      archival_available: true,
      ...over,
    })} returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${org()}, ${tier!.id}, ${status}::subscription_status)
  `
  return tier!.id
}

const asOwner = () =>
  asRole(fixture.acme, 'owner', (tx) => orgTier(tx, fixture.acme.id))

test('an Org with no subscription has no Tier, rather than a default one', async () => {
  // A real state in v1: there is no payment rail (ADR 0004) and activation is
  // a Platform Admin's manual act (ticket 48). A default Tier here would be an
  // entitlement nobody granted.
  expect(await asOwner()).toBeNull()
})

test('the Owner sees the Tier, its price and its seat allowance', async () => {
  await seedTier()

  const tier = (await asOwner())!

  expect(tier.name).toBe('Team')
  expect(tierPrice(tier)).toEqual({ amount: '$10', unit: 'per seat / month' })
  expect(tierSeats(tier)).toBe('2 to 10 seats')
})

test('a Seat is a person, so the count is Members and not Devices', async () => {
  // `CONTEXT.md` is explicit, and the fixture is built for this: six Members,
  // one of them removed. A removed Member stops consuming a Seat.
  await seedTier()
  await sql`
    insert into devices (member_id, key)
    values (${fixture.acme.members.member}, 'host:one'),
           (${fixture.acme.members.member}, 'host:two')
  `

  expect((await asOwner())!.seatsUsed).toBe(5)
})

test('a Tier with neither price says Contact, never Free', async () => {
  // The failure ticket 80 names explicitly, and the one that costs the most
  // when it happens. Both price columns null is a real Tier.
  await seedTier({
    key: 'enterprise',
    name: 'Enterprise',
    seat_price_usd: null,
    min_seats: 11,
    max_seats: null,
  })

  const tier = (await asOwner())!

  expect(tierPrice(tier)).toEqual({ amount: 'Contact', unit: null })
  expect(tierSeats(tier)).toBe('11 and up')
})

test('archival availability comes from the row, both ways round', async () => {
  const id = await seedTier({ archival_available: false })
  expect((await asOwner())!.archivalAvailable).toBe(false)

  // The whole point of the last criterion: the operator edits a row and the
  // Org's page says something different, with nothing deployed.
  await sql`update tiers set archival_available = true where id = ${id}`
  expect((await asOwner())!.archivalAvailable).toBe(true)
})

test('the retention ceiling is shown, and null is no ceiling rather than none', async () => {
  const id = await seedTier({ retention_max_days: 90 })
  expect(retentionCeiling((await asOwner())!)).toBe('Up to 90 days')

  await sql`update tiers set retention_max_days = null where id = ${id}`
  expect(retentionCeiling((await asOwner())!)).toMatch(/No ceiling/)
})

test('a capability added to the Tier data appears without a deployment', async () => {
  // ADR 0004: the next gate is a data change, not a migration. Nothing in the
  // app names these keys.
  const id = await seedTier()
  expect((await asOwner())!.features).toEqual({})

  await sql`update tiers set features = '{"single_sign_on": true, "audit_export": false}'::jsonb where id = ${id}`

  expect((await asOwner())!.features).toEqual({
    single_sign_on: true,
    audit_export: false,
  })
})

test('status and Tier are read together, so a cancelled Org is not entitled', async () => {
  // An Org on the Team Tier with a cancelled subscription is on the Team Tier
  // and entitled to nothing. A page that showed only the name would say the
  // opposite.
  await seedTier({}, 'cancelled')

  const tier = (await asOwner())!

  expect(tier.name).toBe('Team')
  expect(isActive(tier)).toBe(false)
})

test('another Org cannot read this Org’s subscription', async () => {
  await seedTier()

  expect(
    await asRole(fixture.globex, 'owner', (tx) => orgTier(tx, fixture.acme.id)),
  ).toBeNull()
})

test('the Tier page is the Owner’s, and the guard is on the page not the link', async () => {
  // `docs/design/product-ia.md`: the one page inside Org settings an Admin
  // does not reach, because `CONTEXT.md` gives an Admin every setting except
  // billing. The entry is absent from their navigation, and a link nobody
  // renders is still a URL anybody can type.
  const page = readFileSync(
    new URL('../app/(dashboard)/settings/tier/page.tsx', import.meta.url),
    'utf8',
  )

  expect(page).toContain('reachesTier(viewer.role)')
  expect(page).toContain('notFound()')

  // And no Tier key is compared anywhere on it: a capability decided by a key
  // in code is the deployment the `tiers` table exists to avoid.
  expect(page).not.toMatch(/'(team|personal|enterprise|self_hosted)'/)
})
