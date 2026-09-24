import { beforeEach, expect, test } from 'vitest'

import {
  listOrgs,
  pendingOrgCount,
  requestPlan,
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

test('Orgs waiting for approval come first, and are counted', async () => {
  // Ticket 120. Newest first would put Globex on top; Acme has been waiting.
  const tierId = await seedTier('team')
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.globex.id,
      tierId,
      status: 'active',
      note: null,
    }),
  )
  await sql`
    insert into subscriptions (org_id, tier_id, status, requested_seats)
    values (${fixture.acme.id}, ${tierId}, 'inactive', 4)
  `

  const { orgs } = await asOperator((tx) => listOrgs(tx))
  expect(orgs.map((org) => [org.id, org.pending])).toEqual([
    [fixture.acme.id, true],
    [fixture.globex.id, false],
  ])
  // What the Org asked for, so the operator knows what to confirm.
  expect(orgs[0]).toMatchObject({ tierKey: 'team', requestedSeats: 4 })

  // No row at all is pending too: every Org from before ticket 118.
  await sql`delete from subscriptions where org_id = ${fixture.acme.id}`
  await sql`insert into orgs (name) values ('Initech')`
  expect(await asOperator(pendingOrgCount)).toBe(2)
})

// Ticket 118: sign-up asks for a plan, and the ask is an `inactive` row.

const seedSizedTier = async (key: string, min: number, max: number) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, min_seats, max_seats, features)
    values (${key}, ${key}, 10, ${min}, ${max}, '{"self_serve": true}')
    returning id
  `
  return tier!.id
}

test('only the Owner asks, only once, only inactive, only a size the Tier allows', async () => {
  const tierId = await seedSizedTier('team', 2, 10)
  const ask = (
    role: Parameters<typeof asRole>[1],
    seats: number | null = 5,
    org = fixture.acme,
  ) =>
    asRole(org, role, (tx) =>
      requestPlan(tx, { orgId: fixture.acme.id, tierKey: 'team', seats }),
    )

  // Billing is the one thing an Admin does not reach.
  await expect(ask('admin')).rejects.toThrow(/row-level security/)
  await expect(ask('member')).rejects.toThrow(/row-level security/)
  // Another Org's Owner cannot ask on Acme's behalf.
  await expect(ask('owner', 5, fixture.globex)).rejects.toThrow(
    /row-level security/,
  )
  // Eleven is past the Team ceiling.
  await expect(ask('owner', 11)).rejects.toThrow(/row-level security/)

  // An ask is never an activation.
  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setSubscription(tx, {
        orgId: fixture.acme.id,
        tierId,
        status: 'active',
        note: null,
      }),
    ),
  ).rejects.toThrow(/row-level security/)

  expect(await ask('owner')).toBe(true)
  // A second ask finds the first and changes nothing.
  expect(await ask('owner', 3)).toBe(false)
  const [row] = await sql<{ status: string; requested_seats: number }[]>`
    select status, requested_seats from subscriptions
     where org_id = ${fixture.acme.id}
  `
  expect(row).toEqual({ status: 'inactive', requested_seats: 5 })
})

test('an ask names a self-serve Tier, and states its size', async () => {
  await seedSizedTier('team', 2, 10)
  // On sale, but "contact us": not something a sign-up can ask for.
  await sql`
    insert into tiers (key, name, min_seats, max_seats)
    values ('enterprise', 'Enterprise', 11, null)
  `
  const ask = (tierKey: string, seats: number | null) =>
    asRole(fixture.acme, 'owner', (tx) =>
      requestPlan(tx, { orgId: fixture.acme.id, tierKey, seats }),
    )

  await expect(ask('enterprise', 12)).rejects.toThrow(/row-level security/)
  await expect(ask('team', null)).rejects.toThrow(/row-level security/)
  expect(await ask('team', 2)).toBe(true)
})

test('an agreed price is the operator’s to set; the Owner reads it and cannot write it', async () => {
  const tierId = await seedTier('enterprise')
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'active',
      note: null,
      priceBaseCents: 50_000,
      priceSeatCents: 800,
    }),
  )

  // Read as before: the Org's own row, through `subscriptions_read`.
  const tier = await asRole(fixture.acme, 'owner', (tx) =>
    orgTier(tx, fixture.acme.id),
  )
  expect(tier).toMatchObject({ priceBaseCents: 50_000, priceSeatCents: 800 })

  // As `sessclone_app`, the Owner's update touches nothing: `subscriptions_write`
  // is the platform flag and nothing else.
  const updated = await asRole(
    fixture.acme,
    'owner',
    (tx) => tx`
      update subscriptions set price_base_cents = 0, price_seat_cents = 0
       where org_id = ${fixture.acme.id}
    `,
  )
  expect(updated.count).toBe(0)
  const [row] = await sql<{ base: number; seat: number }[]>`
    select price_base_cents as base, price_seat_cents as seat
      from subscriptions where org_id = ${fixture.acme.id}
  `
  expect(row).toEqual({ base: 50_000, seat: 800 })
})

test('an Owner’s ask cannot carry an agreed price', async () => {
  const tierId = await seedSizedTier('team', 2, 10)
  // Everything else is a valid ask; only the price is the Owner's to not set.
  const ask = (base: number | null, seat: number | null) =>
    asRole(
      fixture.acme,
      'owner',
      (tx) => tx`
        insert into subscriptions
          (org_id, tier_id, status, requested_seats,
           price_base_cents, price_seat_cents)
        values (${fixture.acme.id}, ${tierId}, 'inactive', 5, ${base}, ${seat})
      `,
    )

  await expect(ask(0, null)).rejects.toThrow(/row-level security/)
  await expect(ask(null, 0)).rejects.toThrow(/row-level security/)
  expect((await ask(null, null)).count).toBe(1)
})

test('a price-only change is a change, and the history keeps the price', async () => {
  const tierId = await seedTier('enterprise')
  const set = (priceBaseCents: number | null, note: string) =>
    asOperator((tx) =>
      setSubscription(tx, {
        orgId: fixture.acme.id,
        tierId,
        status: 'active',
        note,
        priceBaseCents,
        priceSeatCents: null,
      }),
    )

  await set(null, 'activated')
  expect(await set(50_000, 'agreed on the call')).toEqual({
    saved: true,
    recorded: true,
  })

  const events = await sql<{ note: string; base: number | null }[]>`
    select note, price_base_cents as base from subscription_events
     where org_id = ${fixture.acme.id} order by id
  `
  expect(events).toEqual([
    { note: 'activated', base: null },
    { note: 'agreed on the call', base: 50_000 },
  ])
})

test("the history reads each event's agreed price back", async () => {
  const tierId = await seedTier('enterprise')
  const set = (priceBaseCents: number | null, priceSeatCents: number | null) =>
    asOperator((tx) =>
      setSubscription(tx, {
        orgId: fixture.acme.id,
        tierId,
        status: 'active',
        note: null,
        priceBaseCents,
        priceSeatCents,
      }),
    )

  await set(null, null)
  await set(50_000, 800)

  const history = await asOperator((tx) =>
    subscriptionHistory(tx, fixture.acme.id),
  )
  expect(
    history.map(({ priceBaseCents, priceSeatCents }) => ({
      priceBaseCents,
      priceSeatCents,
    })),
  ).toEqual([
    { priceBaseCents: 50_000, priceSeatCents: 800 },
    { priceBaseCents: null, priceSeatCents: null },
  ])
})

test('a status-only change keeps the agreed price', async () => {
  const tierId = await seedTier('enterprise')
  const set = (price: { priceBaseCents?: null; priceSeatCents?: null } = {}) =>
    asOperator((tx) =>
      setSubscription(tx, {
        orgId: fixture.acme.id,
        tierId,
        status: 'past_due',
        note: null,
        ...price,
      }),
    )
  await asOperator((tx) =>
    setSubscription(tx, {
      orgId: fixture.acme.id,
      tierId,
      status: 'active',
      note: null,
      priceBaseCents: 50_000,
      priceSeatCents: 800,
    }),
  )

  // Omitted is "leave it"; only an explicit null clears it.
  expect(await set()).toEqual({ saved: true, recorded: true })
  const price = () => sql<{ base: number | null; seat: number | null }[]>`
    select price_base_cents as base, price_seat_cents as seat
      from subscriptions where org_id = ${fixture.acme.id}
  `
  expect(await price()).toEqual([{ base: 50_000, seat: 800 }])
  expect(await set()).toEqual({ saved: true, recorded: false })

  await set({ priceBaseCents: null, priceSeatCents: null })
  expect(await price()).toEqual([{ base: null, seat: null }])
})
