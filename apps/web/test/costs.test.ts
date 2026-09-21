import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 42: the estimated Cost of a Turn, derived at read time.
//
// Against a real Postgres with the real migrations, because the computation
// *is* SQL — `turn_costs` in `supabase/migrations/…_turn_costs.sql` — and the
// rate table it joins is seeded by a migration too. A unit test over a
// re-implementation in TypeScript would prove that the re-implementation
// agrees with itself.
//
// Every figure below is read from the seed in `…_rate_seed.sql`, which in turn
// records the published page and the date it was read. `claude-opus-4-6` is
// $5 / $25 per MTok in and out, $6.25 and $10 for the two cache writes, $0.50
// for a cache read; a web search is $10 per 1,000 and a web fetch is free.

// The harness truncates every table between tests, so the price list the
// migration seeded is gone by the time one runs. It is re-applied from the
// migration file itself rather than from a copy of its numbers, for the reason
// `rate-seed.test.ts` gives: a test that restated the prices would pass while
// the migration said something else.
const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(SEED, 'utf8'))
})

/** Every counter zero, so each test sets only the ones it is about. */
const NOTHING = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation_5m_input_tokens: 0,
  cache_creation_1h_input_tokens: 0,
  thinking_tokens: 0,
  web_search_requests: 0,
  web_fetch_requests: 0,
}

const MILLION = 1_000_000
let nextMessage = 0

/** One Turn for Acme's Member, seeded as the owner — the path ingest takes. */
const seedTurn = async (over: Record<string, unknown> = {}) => {
  nextMessage += 1
  const row = {
    org_id: fixture.acme.id,
    member_id: fixture.acme.members.member,
    session_id: 'session-1',
    message_id: `msg_${nextMessage}`,
    occurred_at: '2026-09-20T08:00:00Z',
    model: 'claude-opus-4-6',
    service_tier: 'standard',
    speed: null,
    inference_geo: null,
    ...NOTHING,
    ...over,
  }

  const [turn] = await sql<{ id: string }[]>`
    insert into turns ${sql(row)} returning id
  `
  return turn!.id
}

/** What the view says a Turn costs, as a number or null. */
const costOf = async (turnId: string) => {
  const [row] = await sql<{ cost_usd: string | null; unpriced: boolean }[]>`
    select cost_usd, unpriced from turn_costs where turn_id = ${turnId}
  `
  return {
    cost: row!.cost_usd === null ? null : Number(row!.cost_usd),
    unpriced: row!.unpriced,
  }
}

test('each token class is priced by its own rate, not by a multiple of input', async () => {
  // A million of each class, so the figure is the published price itself and
  // a class priced off the wrong row is visible rather than plausible.
  const turn = await seedTurn({
    input_tokens: MILLION,
    output_tokens: MILLION,
    cache_read_input_tokens: MILLION,
    cache_creation_5m_input_tokens: MILLION,
    cache_creation_1h_input_tokens: MILLION,
  })

  expect(await costOf(turn)).toEqual({
    cost: 5 + 25 + 0.5 + 6.25 + 10,
    unpriced: false,
  })
})

test('thinking tokens and the reported cache total are not billed twice', async () => {
  // `thinking_tokens` is a subset of output and `cache_creation_input_tokens`
  // is the total whose split is already priced. Both are stored; neither is a
  // class.
  const turn = await seedTurn({
    output_tokens: MILLION,
    thinking_tokens: MILLION,
    cache_creation_5m_input_tokens: MILLION,
    cache_creation_input_tokens: MILLION,
  })

  expect((await costOf(turn)).cost).toBe(25 + 6.25)
})

test('server-tool requests are priced per request, separately from tokens', async () => {
  const turn = await seedTurn({ web_search_requests: 500 })

  // $10 per 1,000 searches, and the model's own rates do not enter into it.
  expect((await costOf(turn)).cost).toBe(5)
})

test('a free server tool is a priced zero, not an unpriced Turn', async () => {
  // Web fetch is seeded at zero rather than omitted, so the day it stops being
  // free is a row rather than a migration.
  const turn = await seedTurn({ web_fetch_requests: 40 })

  expect(await costOf(turn)).toEqual({ cost: 0, unpriced: false })
})

test('fast mode doubles the rate on Opus 4.8 and later', async () => {
  const fast = await seedTurn({
    model: 'claude-opus-5',
    speed: 'fast',
    input_tokens: MILLION,
  })
  const standard = await seedTurn({
    model: 'claude-opus-5',
    input_tokens: MILLION,
  })

  expect((await costOf(fast)).cost).toBe(10)
  expect((await costOf(standard)).cost).toBe(5)
})

test('fast mode on a model it does not apply to leaves the rate alone', async () => {
  // The ADR names Opus 5 and Opus 4.8. Sonnet is not one of them, and neither
  // is Opus 4.6 — applying it anyway would overstate by half.
  const sonnet = await seedTurn({
    model: 'claude-sonnet-5',
    speed: 'fast',
    input_tokens: MILLION,
  })
  const olderOpus = await seedTurn({
    model: 'claude-opus-4-6',
    speed: 'fast',
    input_tokens: MILLION,
  })

  expect((await costOf(sonnet)).cost).toBe(2)
  expect((await costOf(olderOpus)).cost).toBe(5)
})

test('US-only inference is 1.1x across every class on 4.6 and later', async () => {
  const us = await seedTurn({
    inference_geo: 'us',
    input_tokens: MILLION,
    output_tokens: MILLION,
  })

  expect((await costOf(us)).cost).toBeCloseTo((5 + 25) * 1.1, 10)
})

test('US-only inference does not reach back before 4.6', async () => {
  const older = await seedTurn({
    model: 'claude-haiku-4-5',
    inference_geo: 'us',
    input_tokens: MILLION,
  })

  expect((await costOf(older)).cost).toBe(1)
})

test('the batch tier halves the tokens and leaves the server tools alone', async () => {
  const batch = await seedTurn({
    service_tier: 'batch',
    input_tokens: MILLION,
    web_search_requests: 1000,
  })

  expect((await costOf(batch)).cost).toBe(5 / 2 + 10)
})

test('the modifiers never reach the model-independent server-tool rates', async () => {
  // The rate seed prices a web search at $10 per 1,000 "whoever answered", so
  // it is not a per-model rate and the three per-model modifiers have nothing
  // to say about it. Applied anyway, this Turn's searches would cost $11 —
  // and $20 on fast mode alone.
  const turn = await seedTurn({
    model: 'claude-opus-5',
    speed: 'fast',
    inference_geo: 'us',
    service_tier: 'batch',
    web_search_requests: 1000,
  })

  expect((await costOf(turn)).cost).toBe(10)
})

test('a Vertex model id carries the same generation as its plain form', async () => {
  // Vertex spells the snapshot with an `@` rather than a `-`. Read as a bare
  // major, a fast-mode US Opus 4.8 loses both modifiers and is understated by
  // 55% — silently, and reported as priced. A rate row naming the Vertex id
  // (an Org override, say) would then be multiplied by 1 instead of 2.2.
  //
  // Tested through the function rather than a Turn because a rate matches a
  // model id exactly, so a Vertex id with no row of its own is unpriced for
  // that reason and would hide this one.
  const [row] = await sql<{ vertex: number; plain: number }[]>`
    select sessclone_price_multiplier(
             'claude-opus-4-8@20260101', 'fast', 'us', 'standard'
           )::float8 as vertex,
           sessclone_price_multiplier(
             'claude-opus-4-8', 'fast', 'us', 'standard'
           )::float8 as plain
  `

  expect(row!.vertex).toBeCloseTo(2.2, 10)
  expect(row!.vertex).toBe(row!.plain)
})

test('a two-digit minor version is a later generation, not an earlier one', async () => {
  // A minor is a counter and not a decimal. Folded in as tenths,
  // `claude-opus-4-10` reads as 5.0 — a generation that does not exist.
  const [row] = await sql<{ ten: number; eight: number; five: number }[]>`
    select sessclone_model_generation('claude-opus-4-10')::float8 as ten,
           sessclone_model_generation('claude-opus-4-8')::float8 as eight,
           sessclone_model_generation('claude-opus-5')::float8 as five
  `

  expect(row!.ten).toBeGreaterThan(row!.eight)
  expect(row!.ten).toBeLessThan(row!.five)
})

test('a reported cache-write total with no split is unpriced, not free', async () => {
  // `packages/shared/src/turns.ts`: an entry can state a total and no split at
  // all. Pricing the shortfall at the 5m rate would be a guess; pricing it at
  // nothing is the $0-that-looks-authoritative ADR 0002 forbids.
  const turn = await seedTurn({
    cache_creation_input_tokens: MILLION,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
  })

  expect(await costOf(turn)).toEqual({ cost: null, unpriced: true })
})

test('the modifiers compose rather than overriding one another', async () => {
  const turn = await seedTurn({
    model: 'claude-opus-5',
    speed: 'fast',
    inference_geo: 'us',
    service_tier: 'batch',
    input_tokens: MILLION,
  })

  expect((await costOf(turn)).cost).toBeCloseTo(5 * 2 * 1.1 * 0.5, 10)
})

test('a model with no rate yields no Cost, never zero', async () => {
  const unknown = await seedTurn({
    model: 'anthropic.claude-something-v9:0',
    input_tokens: MILLION,
  })

  expect(await costOf(unknown)).toEqual({ cost: null, unpriced: true })
})

test('a Turn with no model at all is unpriced, not free', async () => {
  // `<synthetic>` and a null model are both real: an iteration record carries
  // no model, and no Rate will ever match one.
  const synthetic = await seedTurn({ model: null, output_tokens: 10 })

  expect(await costOf(synthetic)).toEqual({ cost: null, unpriced: true })
})

test('an unpriced model with a priced server tool is still unpriced', async () => {
  // The web search has a rate and the tokens do not. Adding up the part that
  // resolves would be a total that looks authoritative and is short.
  const turn = await seedTurn({
    model: 'something-else',
    input_tokens: MILLION,
    web_search_requests: 1000,
  })

  expect(await costOf(turn)).toEqual({ cost: null, unpriced: true })
})

test('a Turn that consumed nothing costs nothing and is not unpriced', async () => {
  const empty = await seedTurn()

  expect(await costOf(empty)).toEqual({ cost: 0, unpriced: false })
})

test('adding a rate later changes the computed Cost of an existing Turn', async () => {
  const turn = await seedTurn({
    model: 'claude-unreleased-6',
    input_tokens: MILLION,
  })

  expect(await costOf(turn)).toEqual({ cost: null, unpriced: true })

  await sql`
    insert into rates (model, class, price_usd, effective_from, source)
    values ('claude-unreleased-6', 'input', 7, date '2026-01-01', 'test')
  `

  // No backfill, no recomputation, no stored figure to invalidate.
  expect(await costOf(turn)).toEqual({ cost: 7, unpriced: false })
})

test('a Turn keeps the price that was live on the day it ran', async () => {
  const before = await seedTurn({
    model: 'claude-dated-6',
    input_tokens: MILLION,
    occurred_at: '2026-03-01T00:00:00Z',
  })
  const after = await seedTurn({
    model: 'claude-dated-6',
    input_tokens: MILLION,
    occurred_at: '2026-07-01T00:00:00Z',
  })

  await sql`
    insert into rates (model, class, price_usd, effective_from, source)
    values ('claude-dated-6', 'input', 3, date '2026-01-01', 'test'),
           ('claude-dated-6', 'input', 9, date '2026-06-01', 'test')
  `

  expect((await costOf(before)).cost).toBe(3)
  expect((await costOf(after)).cost).toBe(9)
})

test("an Org's negotiated override beats the platform table", async () => {
  const acme = await seedTurn({ input_tokens: MILLION })
  const globex = await seedTurn({
    org_id: fixture.globex.id,
    member_id: fixture.globex.members.member,
    input_tokens: MILLION,
  })

  await sql`
    insert into org_rate_overrides (org_id, model, class, price_usd, effective_from)
    values (${fixture.acme.id}, 'claude-opus-4-6', 'input', 2, date '2026-01-01')
  `

  expect((await costOf(acme)).cost).toBe(2)
  // And nobody else's. An override is invisible outside the Org that has it.
  expect((await costOf(globex)).cost).toBe(5)
})

test('a row naming the model beats a model-independent one', async () => {
  const turn = await seedTurn({ web_search_requests: 1000 })

  await sql`
    insert into rates (model, class, price_usd, effective_from, source)
    values ('claude-opus-4-6', 'web_search_request', 4, date '2026-01-01', 'test')
  `

  expect((await costOf(turn)).cost).toBe(4)
})

test('the view reads as the viewer, so a Cost is only visible where the Turn is', async () => {
  // `security_invoker` on the view. Without it the view would read with the
  // rights of the role that owns the tables, which Postgres exempts from every
  // policy — and one Org's spend would be readable by every other.
  await seedTurn({ input_tokens: MILLION })

  const acme = await asRole(
    fixture.acme,
    'owner',
    (tx) => tx`select turn_id from turn_costs`,
  )
  const globex = await asRole(
    fixture.globex,
    'owner',
    (tx) => tx`select turn_id from turn_costs`,
  )

  expect(acme).toHaveLength(1)
  expect(globex).toEqual([])
})

test("an Org's override is not readable from another Org, even through the view", async () => {
  await sql`
    insert into org_rate_overrides (org_id, model, class, price_usd, effective_from)
    values (${fixture.acme.id}, 'claude-opus-4-6', 'input', 2, date '2026-01-01')
  `

  const seenByGlobex = await asRole(
    fixture.globex,
    'owner',
    (tx) => tx`select price_usd from rate_periods where org_id is not null`,
  )

  expect(seenByGlobex).toEqual([])
})
