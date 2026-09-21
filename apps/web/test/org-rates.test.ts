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

test('one Org’s negotiated prices are invisible to another Org', async () => {
  await negotiated()

  // Globex's Owner cannot read that Acme has an arrangement at all. What that
  // does to Globex's Costs is `costs.test.ts`'s, read there as each Org's own
  // Owner rather than on the owning connection, which no policy applies to.
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

test('a live override is compared against today’s list price', async () => {
  // The platform price moved after the override started. Comparing the
  // discount against the price it replaced on the day it was signed reads a
  // 67% discount as 40% — and an operator checking a contract is doing
  // exactly that comparison.
  await negotiated()
  await sql`
    insert into rates (model, class, price_usd, effective_from, source)
    values ('claude-opus-4-6', 'input', 9, '2026-09-10', 'a price rise')
  `

  const { rates } = await asOperator((tx) => listOrgRates(tx, fixture.acme.id))

  expect(rates[0]).toMatchObject({ priceUsd: 3, current: true, platformUsd: 9 })
})

test('an override that has not started yet is scheduled, not superseded', async () => {
  // Landing next year's price in advance is what effective dating is for, and
  // a row labelled superseded is a row somebody deletes.
  const started = await negotiated()
  await negotiated({ priceUsd: 2, effectiveFrom: '2027-01-01' })

  const { rates } = await asOperator((tx) => listOrgRates(tx, fixture.acme.id))
  const scheduled = rates.find((rate) => rate.effectiveFrom === '2027-01-01')!

  expect(scheduled.current).toBe(false)
  // The row in force today is the older one, and it is the one marked current
  // — so the page can tell "not yet" from "no longer" by the date alone.
  expect(rates.find((rate) => rate.current)!.id).toBe(started)
})
