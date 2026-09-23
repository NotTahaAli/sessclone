import { beforeEach, expect, test } from 'vitest'

import {
  listOrgs,
  setSubscription,
  subscriptionHistory,
} from '../lib/subscriptions'
import { orgTier } from '../lib/tier'
import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'

// Ticket 48. Activation is a person's decision with no payment rail behind it
// (ADR 0004), so what is worth proving is the record it leaves: who did it,
// when, and why — and that neither an Org's own Owner nor anybody else can
// write it.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const asOperator = <T>(query: Parameters<typeof asUser<T>>[1]) =>
  asUser(fixture.platformAdmin.userId, query)

const seedTier = async (key: string, maxSeats: number | null = 10) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, description, seat_price_usd, max_seats,
                       retention_max_days, archival_available, sort_order)
    values (${key}, ${key}, 'A tier.', 10, ${maxSeats}, 365, true, 1)
    returning id
  `
  return tier!.id
}

test('an operator activates an Org, and the event says who and why', async () => {
  const tierId = await seedTier('team')

  expect(
    await asOperator((tx) =>
      setSubscription(tx, {
        orgId: fixture.acme.id,
        tierId,
        status: 'active',
        note: 'invoice INV-2026-014 paid by transfer',
      }),
    ),
  ).toEqual({ saved: true, recorded: true })

  const [event] = await asOperator((tx) =>
    subscriptionHistory(tx, fixture.acme.id),
  )
  expect(event).toMatchObject({
    status: 'active',
    tierName: 'team',
    note: 'invoice INV-2026-014 paid by transfer',
    provider: 'manual',
  })

  // The actor is the person who did it, taken from the claim rather than from
  // anything the caller passed.
  const [operator] = await sql<{ email: string }[]>`
    select email from users where id = ${fixture.platformAdmin.userId}
  `
  expect(event!.actorName).toBe(operator!.email)
})

test('deactivation writes its own event, and the history keeps both', async () => {
  const tierId = await seedTier('team')
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'active',
      note: 'paid',
    }),
  )
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'cancelled',
      note: 'asked to stop',
    }),
  )

  const history = await asOperator((tx) =>
    subscriptionHistory(tx, fixture.acme.id),
  )
  expect(history.map((event) => [event.status, event.note])).toEqual([
    ['cancelled', 'asked to stop'],
    ['active', 'paid'],
  ])
})

test('a note never survives the transaction that wrote it', async () => {
  // The note rides a transaction-local setting, and the connection is pooled.
  // A later write that sets no note must not inherit this one's, or the audit
  // trail reads as though somebody gave a reason they never gave.
  const tierId = await seedTier('team')
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'active',
      note: 'invoice INV-2026-014 paid by transfer',
    }),
  )

  // Deliberately not through `setSubscription`: this is the shape of every
  // other writer — a webhook in v2, a hand-written statement today — and it
  // sets nothing.
  await asOperator(
    (tx) =>
      tx`update subscriptions set status = 'cancelled'
          where org_id = ${fixture.acme.id}`,
  )

  const [latest] = await asOperator((tx) =>
    subscriptionHistory(tx, fixture.acme.id),
  )
  expect(latest).toMatchObject({ status: 'cancelled', note: null })
})

test('entitlement follows the row, so activation needs no deployment', async () => {
  const tierId = await seedTier('team')

  expect(
    await asRole(fixture.acme, 'owner', (tx) => orgTier(tx, fixture.acme.id)),
  ).toBeNull()

  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'active',
      note: null,
    }),
  )

  expect(
    await asRole(fixture.acme, 'owner', (tx) => orgTier(tx, fixture.acme.id)),
  ).toMatchObject({ key: 'team', status: 'active' })
})

test('an Org Owner cannot activate their own Org', async () => {
  const tierId = await seedTier('team')

  // `subscriptions_write` is the platform flag and nothing else. The insert is
  // refused outright rather than written and then hidden.
  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setSubscription(tx, {
        orgId: fixture.acme.id,
        tierId,
        status: 'active',
        note: 'I paid, honest',
      }),
    ),
  ).rejects.toThrow(/row-level security/)

  expect(
    await asRole(fixture.acme, 'owner', (tx) => orgTier(tx, fixture.acme.id)),
  ).toBeNull()
})

test('an Org reads its own history and nobody else’s', async () => {
  const tierId = await seedTier('team')
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'active',
      note: 'paid',
    }),
  )

  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      subscriptionHistory(tx, fixture.acme.id),
    ),
  ).toHaveLength(1)
  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      subscriptionHistory(tx, fixture.acme.id),
    ),
  ).toEqual([])
})

test('the operator sees every Org with its Tier and Seats; an Owner sees one', async () => {
  const tierId = await seedTier('team')
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'active',
      note: null,
    }),
  )

  const { orgs } = await asOperator((tx) => listOrgs(tx))
  const acme = orgs.find((org) => org.id === fixture.acme.id)
  const globex = orgs.find((org) => org.id === fixture.globex.id)

  // Five Members are seeded and one is removed, so a Seat is not a row.
  expect(acme).toMatchObject({ tierKey: 'team', status: 'active', seats: 5 })
  // No subscription is a state, not a missing Org.
  expect(globex).toMatchObject({ tierKey: null, status: null })

  const own = await asRole(fixture.acme, 'owner', (tx) => listOrgs(tx))
  expect(own.orgs.map((org) => org.id)).toEqual([fixture.acme.id])
})

test('the Org list is cut rather than unbounded', async () => {
  const { orgs, more } = await asOperator((tx) => listOrgs(tx, { limit: 1 }))
  expect(orgs).toHaveLength(1)
  expect(more).toBe(true)
})

test('a save that changes nothing says so instead of claiming a record', async () => {
  const tierId = await seedTier('team')
  const set = (note: string) =>
    asOperator((tx) =>
      setSubscription(tx, {
        orgId: fixture.acme.id,
        tierId,
        status: 'active',
        note,
      }),
    )

  expect(await set('invoice INV-2026-014')).toEqual({
    saved: true,
    recorded: true,
  })

  // `sessclone_write_subscription_event` returns early when neither the Tier
  // nor the status moved, so a note typed beside an unchanged subscription
  // goes nowhere — and the page must not say the history below is the record.
  expect(await set('meant to correct the note')).toEqual({
    saved: true,
    recorded: false,
  })

  const history = await asOperator((tx) =>
    subscriptionHistory(tx, fixture.acme.id),
  )
  expect(history.map((event) => event.note)).toEqual(['invoice INV-2026-014'])
})

test('the Org list can be filtered by name, so a capped list is reachable', async () => {
  const { orgs } = await asOperator((tx) => listOrgs(tx, { name: 'cme' }))
  expect(orgs.map((org) => org.id)).toEqual([fixture.acme.id])

  expect(
    (await asOperator((tx) => listOrgs(tx, { name: 'nobody' }))).orgs,
  ).toEqual([])
})

test('a hand-made change to a provider’s row is recorded as manual', async () => {
  const tierId = await seedTier('team')
  await sql`
    insert into subscriptions (org_id, tier_id, status, provider)
    values (${fixture.globex.id}, ${tierId}, 'active', 'stripe')
  `

  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.globex.id,
      tierId,
      status: 'past_due',
      note: 'transfer never arrived',
    }),
  )

  const [event] = await asOperator((tx) =>
    subscriptionHistory(tx, fixture.globex.id),
  )
  // Otherwise the history attributes a person's decision to Stripe.
  expect(event).toMatchObject({ status: 'past_due', provider: 'manual' })
})
