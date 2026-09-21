import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import { orgSpend, unknownModels } from '../lib/spend'
import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'

// Ticket 43: "cost unknown" and "cost zero" are different answers, and the
// read path has to keep them apart all the way to the caller.
//
// The per-Turn half is ticket 42's and is proven in `costs.test.ts`. What is
// proven here is the half that gets it wrong by accident: `sum` over a column
// with nulls returns a number, and nothing about that number says it priced
// only some of the rows. `lib/spend.ts` is the seam that refuses to hand one
// back alone.

const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

const MILLION = 1_000_000
let fixture: Fixture
let nextMessage = 0

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(SEED, 'utf8'))
  nextMessage = 0
})

/** One Turn, seeded as the owner — the path ingest takes. */
const seedTurn = async (over: Record<string, unknown> = {}) => {
  nextMessage += 1
  const row = {
    org_id: fixture.acme.id,
    member_id: fixture.acme.members.member,
    session_id: 'session-1',
    message_id: `msg_${nextMessage}`,
    occurred_at: '2026-09-20T08:00:00Z',
    model: 'claude-opus-4-6',
    input_tokens: 0,
    ...over,
  }
  const [turn] = await sql<{ id: string }[]>`
    insert into turns ${sql(row)} returning id
  `
  return turn!.id
}

test('an unpriced Turn is counted, not added as zero', async () => {
  // The whole ticket in one case. Two Turns of a million input tokens each,
  // one on a model the seed prices and one on a model it does not. A caller
  // that only had `sum(cost_usd)` would show $5 and imply that is what the Org
  // spent.
  await seedTurn({ input_tokens: MILLION })
  await seedTurn({ model: 'claude-unreleased-9', input_tokens: MILLION })

  const spend = await asRole(fixture.acme, 'owner', (tx) =>
    orgSpend(tx, fixture.acme.id),
  )

  expect(spend).toEqual({ costUsd: 5, pricedTurns: 1, unpricedTurns: 1 })
})

test('a Turn that consumed nothing is priced at zero, not unpriced', async () => {
  // The other direction, and the reason the two counts are both reported
  // rather than one count and a subtraction: a zero here is a real zero.
  await seedTurn()

  expect(
    await asRole(fixture.acme, 'owner', (tx) => orgSpend(tx, fixture.acme.id)),
  ).toEqual({ costUsd: 0, pricedTurns: 1, unpricedTurns: 0 })
})

test('an Org with no Turns at all reports zero rather than nothing', async () => {
  // `sum` over no rows is null and `count` is 0. A caller reading this into a
  // chart axis should get a number, not a null it has to remember to handle.
  expect(
    await asRole(fixture.acme, 'owner', (tx) => orgSpend(tx, fixture.acme.id)),
  ).toEqual({ costUsd: 0, pricedTurns: 0, unpricedTurns: 0 })
})

test('the window bounds the total and the unpriced count together', async () => {
  await seedTurn({ input_tokens: MILLION, occurred_at: '2026-09-20T08:00:00Z' })
  await seedTurn({
    model: 'claude-unreleased-9',
    input_tokens: MILLION,
    occurred_at: '2026-09-20T08:00:00Z',
  })
  await seedTurn({ input_tokens: MILLION, occurred_at: '2026-06-01T08:00:00Z' })

  const september = await asRole(fixture.acme, 'owner', (tx) =>
    orgSpend(tx, fixture.acme.id, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    }),
  )

  expect(september).toEqual({ costUsd: 5, pricedTurns: 1, unpricedTurns: 1 })
})

test('the window is half-open, so a Turn is in exactly one month', async () => {
  // The boundary, because a closed range double-counts the Turn that lands on
  // midnight and every monthly total downstream inherits it.
  await seedTurn({ input_tokens: MILLION, occurred_at: '2026-10-01T00:00:00Z' })

  const september = await asRole(fixture.acme, 'owner', (tx) =>
    orgSpend(tx, fixture.acme.id, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-10-01T00:00:00Z'),
    }),
  )
  const october = await asRole(fixture.acme, 'owner', (tx) =>
    orgSpend(tx, fixture.acme.id, {
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-11-01T00:00:00Z'),
    }),
  )

  expect(september.pricedTurns).toBe(0)
  expect(october.pricedTurns).toBe(1)
})

test('the Org id is a filter and the policy is the authorisation', async () => {
  // Naming another Org returns nothing rather than something: `turn_costs` is
  // `security_invoker` and `turns_read` decides whose Turns are visible.
  await seedTurn({ input_tokens: MILLION })

  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      orgSpend(tx, fixture.acme.id),
    ),
  ).toEqual({ costUsd: 0, pricedTurns: 0, unpricedTurns: 0 })
})

test('a Manager sees their Scope, and a Manager without one sees nothing', async () => {
  // The count is as policy-bound as the total. A Manager whose Scope is empty
  // must not learn the Org has unpriced Turns by seeing a count of them.
  await seedTurn({ model: 'claude-unreleased-9', input_tokens: MILLION })

  const scoped = await asRole(fixture.acme, 'manager', (tx) =>
    orgSpend(tx, fixture.acme.id),
  )
  const unscoped = await asRole(fixture.acme, 'managerWithoutScope', (tx) =>
    orgSpend(tx, fixture.acme.id),
  )

  expect(scoped.unpricedTurns).toBe(1)
  expect(unscoped).toEqual({ costUsd: 0, pricedTurns: 0, unpricedTurns: 0 })
})

test('the unknown models are the operator’s to see and nobody else’s', async () => {
  await seedTurn({ model: 'claude-unreleased-9', input_tokens: MILLION })
  await seedTurn({ model: 'claude-unreleased-9', input_tokens: MILLION })
  await seedTurn({ input_tokens: MILLION })

  const operator = await asUser(fixture.platformAdmin.userId, (tx) =>
    unknownModels(tx),
  )

  expect(operator).toHaveLength(1)
  expect(operator[0]!.model).toBe('claude-unreleased-9')
  expect(operator[0]!.turns).toBe(2)

  // An Owner owns an Org; pricing is global and is not theirs. An empty list
  // rather than an error, because "nothing to price" and "not yours" should
  // look the same from outside.
  expect(
    await asRole(fixture.acme, 'owner', (tx) => unknownModels(tx)),
  ).toEqual([])
  expect(
    await asUser(fixture.stranger.userId, (tx) => unknownModels(tx)),
  ).toEqual([])
})

test('the operator sees the model and not whose it is', async () => {
  // The function is `security definer`, so its projection is the boundary. It
  // must never grow an Org, a Member or a token counter.
  await seedTurn({ model: 'claude-unreleased-9', input_tokens: MILLION })

  const columns = await sql<{ name: string }[]>`
    select unnest(proargnames) as name
      from pg_proc where proname = 'sessclone_unknown_models'
  `

  expect(columns.map((row) => row.name).toSorted()).toEqual([
    'last_seen_at',
    'model',
    'turns',
  ])
})

test('a Turn that names no model at all is listed rather than filtered away', async () => {
  await seedTurn({ model: null, input_tokens: MILLION })

  const operator = await asUser(fixture.platformAdmin.userId, (tx) =>
    unknownModels(tx),
  )

  expect(operator.map((row) => row.model)).toEqual([null])
})

test('adding the missing Rate takes the model off the list', async () => {
  await seedTurn({ model: 'claude-unreleased-9', input_tokens: MILLION })

  expect(
    await asUser(fixture.platformAdmin.userId, (tx) => unknownModels(tx)),
  ).toHaveLength(1)

  await sql`
    insert into rates (model, class, price_usd, effective_from)
    values ('claude-unreleased-9', 'input', 3, date '2026-01-01')
  `

  expect(
    await asUser(fixture.platformAdmin.userId, (tx) => unknownModels(tx)),
  ).toEqual([])
})
