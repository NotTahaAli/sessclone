import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import {
  addOrgRate,
  deleteOrgRate,
  listOrgRates,
} from '../lib/org-rates'
import { asRole, asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 64: an Org with negotiated pricing, and the three things that have to
// be true about it — the estimate matches what the Org actually pays, the
// override is effective-dated like every other price, and no other Org can see
// that it exists.
//
// Against a real Postgres with the real migrations, for the reason
// `costs.test.ts` gives: the resolution *is* SQL, and a TypeScript
// re-implementation would only agree with itself.

const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(SEED, 'utf8'))
})

const asOperator = <T>(query: Parameters<typeof asUser<T>>[1]) =>
  asUser(fixture.platformAdmin.userId, query)

const MILLION = 1_000_000
let nextMessage = 0

/** One Turn of a million input tokens, so the Cost is the rate itself. */
const seedTurn = async (orgId: string, memberId: string, day = '2026-09-20') => {
  nextMessage += 1
  const [turn] = await sql<{ id: string }[]>`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at,
                       model, input_tokens)
    values (${orgId}, ${memberId}, 'session-1', ${`msg_${nextMessage}`},
            ${`${day}T08:00:00Z`}, 'claude-opus-4-6', ${MILLION})
    returning id
  `
  return turn!.id
}

const costOf = async (turnId: string) => {
  const [row] = await sql<{ cost_usd: string | null }[]>`
    select cost_usd from turn_costs where turn_id = ${turnId}
  `
  return row!.cost_usd === null ? null : Number(row!.cost_usd)
}

const negotiated = (over: Partial<Parameters<typeof addOrgRate>[1]> = {}) =>
  asOperator((tx) =>
    addOrgRate(tx, {
      orgId: fixture.acme.id,
      model: 'claude-opus-4-6',
      class: 'input',
      priceUsd: 3,
      effectiveFrom: '2026-09-01',
      note: 'MSA 2026-03, schedule B',
      ...over,
    }),
  )

test('an Org on a negotiated price is estimated at the price it pays', async () => {
  const turn = await seedTurn(fixture.acme.id, fixture.acme.members.member)
  // The published price for this model and class, from the seed migration.
  expect(await costOf(turn)).toBe(5)

  await negotiated()

  expect(await costOf(turn)).toBe(3)
})

test('an override is effective-dated, so an earlier Turn keeps its price', async () => {
  const before = await seedTurn(
    fixture.acme.id,
    fixture.acme.members.member,
    '2026-08-31',
  )
  const after = await seedTurn(
    fixture.acme.id,
    fixture.acme.members.member,
    '2026-09-02',
  )

  await negotiated()

  // What August cost stays what it cost: the override starts on 1 September.
  expect(await costOf(before)).toBe(5)
  expect(await costOf(after)).toBe(3)
})

test('the platform price is the fallback, per class rather than per Org', async () => {
  const turn = await seedTurn(fixture.acme.id, fixture.acme.members.member)

  // A negotiated output price says nothing about input, which still resolves
  // to the published row.
  await negotiated({ class: 'output', priceUsd: 1 })
  expect(await costOf(turn)).toBe(5)

  // And deleting an override puts the Org back on list price, with nothing to
  // backfill — the Cost was never stored (ADR 0002).
  const id = await negotiated()
  expect(await costOf(turn)).toBe(3)
  expect(
    await asOperator((tx) => deleteOrgRate(tx, fixture.acme.id, id)),
  ).toBe(true)
  expect(await costOf(turn)).toBe(5)
})

test('one Org’s negotiated price never reaches another Org', async () => {
  await negotiated()
  const turn = await seedTurn(fixture.globex.id, fixture.globex.members.owner)

  // Globex pays list price, and its Costs are computed from list price.
  expect(await costOf(turn)).toBe(5)

  // Globex's Owner cannot read that Acme has an arrangement at all.
  const theirs = await asRole(fixture.globex, 'owner', (tx) =>
    listOrgRates(tx, fixture.acme.id),
  )
  expect(theirs.rates).toEqual([])

  // Acme's own Members see the rows their invoice is derived from.
  const ours = await asRole(fixture.acme, 'owner', (tx) =>
    listOrgRates(tx, fixture.acme.id),
  )
  expect(ours.rates).toHaveLength(1)
})

test('an Org cannot negotiate its own pricing', async () => {
  // The Owner governs one Org; the price it pays is agreed with whoever runs
  // the deployment. An Owner who could write this table could halve their own
  // invoice.
  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      addOrgRate(tx, {
        orgId: fixture.acme.id,
        model: 'claude-opus-4-6',
        class: 'input',
        priceUsd: 0,
        effectiveFrom: '2026-09-01',
        note: 'free, surely',
      }),
    ),
  ).rejects.toThrow(/row-level security/)

  const id = await negotiated()
  // And cannot delete the one they are on, which would be the same act.
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      deleteOrgRate(tx, fixture.acme.id, id),
    ),
  ).toBe(false)
})

test('the list shows what each override replaces, and what is superseded', async () => {
  await negotiated()
  await negotiated({ priceUsd: 2.5, effectiveFrom: '2026-09-15' })

  const { rates, more } = await asOperator((tx) =>
    listOrgRates(tx, fixture.acme.id),
  )

  expect(more).toBe(false)
  expect(rates.map((rate) => [rate.priceUsd, rate.current])).toEqual([
    [2.5, true],
    [3, false],
  ])
  // The published price of the same model and class, so a number in a contract
  // can be checked against the one it replaces without opening another page.
  expect(rates[0]!.platformUsd).toBe(5)
})

test('an id from another Org is not a capability', async () => {
  const id = await negotiated()

  // Scoped in the statement as well as by policy: a uuid found elsewhere must
  // not delete a row that belongs to somebody else.
  expect(
    await asOperator((tx) => deleteOrgRate(tx, fixture.globex.id, id)),
  ).toBe(false)
  expect(
    (await asOperator((tx) => listOrgRates(tx, fixture.acme.id))).rates,
  ).toHaveLength(1)
})
