import { beforeEach, expect, test } from 'vitest'

import { addRate, deleteRate, listRates } from '../lib/rates'
import { unknownModels } from '../lib/spend'
import { asUser, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 63. The operator's page, so what is worth proving is the two rules a
// surface could quietly break — a price change is a new row, and adding one
// reprices history with no backfill — and the flag that is not a Role.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const asOperator = <T>(query: Parameters<typeof asUser<T>>[1]) =>
  asUser(fixture.platformAdmin.userId, query)

const seedTurn = async (model: string, messageId: string) =>
  sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: 'session-1',
      message_id: messageId,
      occurred_at: '2026-09-20T08:00:00Z',
      model,
      input_tokens: 1_000_000,
    })}
  `

const cost = async (messageId: string) => {
  const [row] = await sql<{ cost_usd: string | null; unpriced: boolean }[]>`
    select cost.cost_usd, cost.unpriced
      from turn_costs cost
      join turns turn on turn.id = cost.turn_id
     where turn.message_id = ${messageId}
  `
  return {
    ...row!,
    cost_usd: row!.cost_usd === null ? null : Number(row!.cost_usd),
  }
}

test('adding a Rate prices the Turns that were waiting for it', async () => {
  await seedTurn('claude-unreleased-9', 'msg_1')
  expect(await cost('msg_1')).toMatchObject({ cost_usd: null, unpriced: true })

  await asOperator((tx) =>
    addRate(tx, {
      model: 'claude-unreleased-9',
      class: 'input',
      priceUsd: 7,
      effectiveFrom: '2026-01-01',
      source: 'published price list, read 2026-09-21',
    }),
  )

  // No backfill, nothing to run: the Cost was never stored, so the next read
  // resolves it (ADR 0002).
  expect(await cost('msg_1')).toMatchObject({ cost_usd: 7, unpriced: false })
})

test('a price change is a second row, and the old one still prices its own days', async () => {
  await asOperator(async (tx) => {
    await addRate(tx, {
      model: 'claude-opus-9',
      class: 'input',
      priceUsd: 5,
      effectiveFrom: '2026-01-01',
      source: null,
    })
    await addRate(tx, {
      model: 'claude-opus-9',
      class: 'input',
      priceUsd: 9,
      effectiveFrom: '2026-09-15',
      source: null,
    })
  })

  await seedTurn('claude-opus-9', 'msg_before')
  await sql`
    update turns set occurred_at = '2026-02-01T08:00:00Z'
     where message_id = 'msg_before'
  `
  await seedTurn('claude-opus-9', 'msg_after')

  expect((await cost('msg_before')).cost_usd).toBe(5)
  expect((await cost('msg_after')).cost_usd).toBe(9)

  const { rates } = await asOperator((tx) => listRates(tx))
  const mine = rates.filter((rate) => rate.model === 'claude-opus-9')
  expect(mine.map((rate) => [rate.effectiveFrom, rate.current])).toEqual([
    ['2026-09-15', true],
    ['2026-01-01', false],
  ])
})

test('a rate dated in the future is listed but is not the current one', async () => {
  await asOperator(async (tx) => {
    await addRate(tx, {
      model: 'claude-opus-9',
      class: 'input',
      priceUsd: 5,
      effectiveFrom: '2026-01-01',
      source: null,
    })
    await addRate(tx, {
      model: 'claude-opus-9',
      class: 'input',
      priceUsd: 11,
      effectiveFrom: '2099-01-01',
      source: null,
    })
  })

  const { rates } = await asOperator((tx) => listRates(tx))
  const current = rates.filter((rate) => rate.current).map((r) => r.priceUsd)
  expect(current).toEqual([5])
})

test('the same model, class and date cannot be written twice', async () => {
  const once = {
    model: 'claude-opus-9',
    class: 'input' as const,
    priceUsd: 5,
    effectiveFrom: '2026-01-01',
    source: null,
  }
  await asOperator((tx) => addRate(tx, once))

  // Never an overwrite: the operator deletes the row if they meant to change
  // what today costs.
  await expect(asOperator((tx) => addRate(tx, once))).rejects.toThrow(
    /duplicate key|unique/i,
  )
})

test('an Org Owner may read the price list and may not write it', async () => {
  await asOperator((tx) =>
    addRate(tx, {
      model: 'claude-opus-9',
      class: 'input',
      priceUsd: 5,
      effectiveFrom: '2026-01-01',
      source: null,
    }),
  )

  const { rates } = await asUser(fixture.acme.users.owner, (tx) =>
    listRates(tx),
  )
  expect(rates.some((rate) => rate.model === 'claude-opus-9')).toBe(true)

  await expect(
    asUser(fixture.acme.users.owner, (tx) =>
      addRate(tx, {
        model: 'claude-opus-9',
        class: 'output',
        priceUsd: 1,
        effectiveFrom: '2026-01-01',
        source: null,
      }),
    ),
  ).rejects.toThrow(/row-level security/)
})

test('the unknown models are the operator’s list and nobody else’s', async () => {
  await seedTurn('claude-unreleased-9', 'msg_1')
  await seedTurn('claude-unreleased-9', 'msg_2')

  const operatorSees = await asOperator((tx) => unknownModels(tx))
  expect(operatorSees.models).toMatchObject([
    { model: 'claude-unreleased-9', turns: 2 },
  ])

  // An Owner of the Org whose Turns those are still gets nothing: the list is
  // deployment-wide, and the flag is not a Role.
  expect(
    await asUser(fixture.acme.users.owner, (tx) => unknownModels(tx)),
  ).toMatchObject({ models: [], more: false })
})

test('deleting a Rate unprices the Turns it was pricing', async () => {
  // The correction path. A Rate is never edited, so a price published by
  // mistake is removed — and because the Cost was never stored, every Turn
  // that resolved to it reprices on the next read rather than on a backfill.
  await seedTurn('claude-unreleased-9', 'msg_1')
  const id = await asOperator((tx) =>
    addRate(tx, {
      model: 'claude-unreleased-9',
      class: 'input',
      priceUsd: 7,
      effectiveFrom: '2026-01-01',
      source: null,
    }),
  )
  expect((await cost('msg_1')).cost_usd).toBe(7)

  expect(await asOperator((tx) => deleteRate(tx, id))).toBe(true)
  expect(await cost('msg_1')).toMatchObject({ cost_usd: null, unpriced: true })
})

test('an Org Owner cannot delete a published price', async () => {
  const id = await asOperator((tx) =>
    addRate(tx, {
      model: 'claude-opus-9',
      class: 'input',
      priceUsd: 5,
      effectiveFrom: '2026-01-01',
      source: null,
    }),
  )

  // Refused by the policy, which touches nothing and raises nothing: the page
  // reports that no row went rather than claiming a deletion.
  expect(
    await asUser(fixture.acme.users.owner, (tx) => deleteRate(tx, id)),
  ).toBe(false)
  expect(await asOperator((tx) => listRates(tx))).toMatchObject({
    rates: expect.arrayContaining([expect.objectContaining({ id })]),
  })
})

test('the price list can be filtered by model, and says when it is cut', async () => {
  // The cap is reachable: a deployment pricing twenty models across seven
  // classes crosses 200 rows in two price revisions, and this page is the
  // only place a Rate can be deleted — so a row the cut hides is a row nobody
  // can correct.
  await asOperator((tx) =>
    Promise.all(
      ['claude-opus-9', 'claude-haiku-9'].map((model) =>
        addRate(tx, {
          model,
          class: 'input',
          priceUsd: 5,
          effectiveFrom: '2026-01-01',
          source: null,
        }),
      ),
    ),
  )

  const { rates } = await asOperator((tx) =>
    listRates(tx, { model: 'haiku-9' }),
  )
  expect(rates.map((rate) => rate.model)).toEqual(['claude-haiku-9'])

  const cut = await asOperator((tx) => listRates(tx, { limit: 1 }))
  expect(cut.rates).toHaveLength(1)
  expect(cut.more).toBe(true)
})

test('the unknown-model list is bounded, because a Collector sends the string', async () => {
  await Promise.all(
    ['alpha', 'beta', 'gamma'].map((model, index) =>
      seedTurn(`claude-${model}`, `msg_unknown_${index}`),
    ),
  )

  const { models, more } = await asOperator((tx) => unknownModels(tx, 2))
  expect(models).toHaveLength(2)
  expect(more).toBe(true)
})

test('filtering by model keeps the rows that price every model', async () => {
  // `null ilike '%opus%'` is null, so an unqualified filter hides exactly the
  // rows a named model falls back to — a web search costs the same whatever
  // the Turn's model is.
  await asOperator((tx) =>
    addRate(tx, {
      model: null,
      class: 'web_search_request',
      priceUsd: 10,
      effectiveFrom: '2026-01-01',
      source: 'published pricing',
    }),
  )

  const { rates } = await asOperator((tx) => listRates(tx, { model: 'opus' }))
  expect(rates.some((rate) => rate.model === null)).toBe(true)
})

// The unknown-model list prices one Turn per shape rather than every Turn
// (2026-10-02: 102k Turns took the Rates page 11s on average, 21s at worst).
// These two hold it to the same answer the per-Turn pass gives, and to being
// cheaper than that pass.

/** What `sessclone_unknown_models` would say if it priced every Turn. */
const unknownByEveryTurn = () => sql<
  { model: string | null; turns: string; last_seen_at: Date }[]
>`
  select turn.model, count(*) as turns, max(turn.occurred_at) as last_seen_at
    from turns turn
    join turn_costs cost on cost.turn_id = turn.id
   where cost.unpriced
   group by turn.model
   order by count(*) desc, turn.model
`

test('the unknown models are the same answer as pricing every Turn', async () => {
  // One trap per thing the grouping keys on: two Turns that differ only in
  // that key, the priced one inserted first so it is the group's
  // representative. Drop the key from the grouping and the unpriced Turn
  // merges into the priced one's group and vanishes from the list.
  await asOperator(async (tx) => {
    await addRate(tx, {
      model: 'claude-partial-9',
      class: 'input',
      priceUsd: 1,
      effectiveFrom: '2026-01-01',
      source: null,
    })
    await addRate(tx, {
      model: 'claude-dated-9',
      class: 'input',
      priceUsd: 1,
      effectiveFrom: '2026-09-20',
      source: null,
    })
  })
  // Globex measures its days from UTC+5 and has its own price for a model the
  // platform table does not price.
  await sql`update orgs set timezone = 'Asia/Karachi' where id = ${fixture.globex.id}`
  await sql`
    insert into org_rate_overrides (org_id, model, class, price_usd, effective_from)
    values (${fixture.globex.id}, 'claude-nowhere-9', 'input', 1, '2026-01-01')
  `

  const acme = { org: fixture.acme, at: '2026-09-20T08:00:00Z' }
  const globex = { org: fixture.globex, at: '2026-09-20T08:00:00Z' }
  const partial = { ...acme, model: 'claude-partial-9' }
  const turns: {
    org: typeof fixture.acme
    at: string
    model: string | null
    counters?: Record<string, number>
  }[] = [
    // Org: the override prices Globex's Turn and not Acme's.
    { ...globex, model: 'claude-nowhere-9' },
    { ...acme, model: 'claude-nowhere-9' },
    // Org-local date: 22:00 UTC on the 19th is the 20th in Karachi, when the
    // dated price starts; 12:00 UTC is still the 19th there.
    { ...globex, model: 'claude-dated-9', at: '2026-09-19T22:00:00Z' },
    { ...globex, model: 'claude-dated-9', at: '2026-09-19T12:00:00Z' },
    // Date alone, in UTC.
    { ...acme, model: 'claude-dated-9', at: '2026-09-20T08:00:00Z' },
    { ...acme, model: 'claude-dated-9', at: '2026-09-19T08:00:00Z' },
    // Each counter, against the input-only Turn the partial price covers.
    partial,
    { ...partial, counters: { output_tokens: 5 } },
    { ...partial, counters: { cache_read_input_tokens: 5 } },
    {
      ...partial,
      counters: {
        cache_creation_input_tokens: 5,
        cache_creation_5m_input_tokens: 5,
      },
    },
    {
      ...partial,
      counters: {
        cache_creation_input_tokens: 5,
        cache_creation_1h_input_tokens: 5,
      },
    },
    { ...partial, counters: { web_search_requests: 1 } },
    { ...partial, counters: { web_fetch_requests: 1 } },
    // A cache-write total with no split, which is unpriced by itself.
    { ...partial, counters: { cache_creation_input_tokens: 5 } },
    // No model at all.
    { ...acme, model: null },
  ]
  await sql`
    insert into turns ${sql(
      turns.map(({ org, at, model, counters }, index) => ({
        org_id: org.id,
        member_id: org.members.member,
        session_id: 'session-1',
        message_id: `msg_shape_${index}`,
        occurred_at: at,
        model,
        // Every row names every column: a multi-row insert takes its column
        // list from the first row.
        input_tokens: 10,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_creation_5m_input_tokens: 0,
        cache_creation_1h_input_tokens: 0,
        web_search_requests: 0,
        web_fetch_requests: 0,
        ...counters,
      })),
    )}
  `

  const { models } = await asOperator((tx) => unknownModels(tx))
  const expected = await unknownByEveryTurn()
  // Every Turn after the first of each pair is unpriced: 1 + 1 + 1 + 7 + 1.
  expect(expected.reduce((sum, row) => sum + Number(row.turns), 0)).toBe(11)
  expect(models).toEqual(
    expected.map((row) => ({
      model: row.model,
      turns: Number(row.turns),
      lastSeenAt: row.last_seen_at,
    })),
  )
})

test('the unknown models price one Turn per shape, not every Turn', async () => {
  // Fifty Turns of one shape. Pricing a Turn looks its Org's overrides up
  // once through `org_rate_overrides_resolution_idx`, so the count of scans
  // of that index in this transaction is the count of Turns priced. Memoize is
  // off because production's plan did not use it at 102k Turns, and with it on
  // a small table hides the per-Turn pass this is about. Exactly one, not
  // fewer than some bound: a plan that stops using the index reads zero and
  // should fail here rather than pass for the wrong reason.
  await sql`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at,
                       model, input_tokens)
    select ${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1',
           'msg_bulk_' || n, '2026-09-20T08:00:00Z', 'claude-unreleased-9', 10
      from generate_series(1, 50) n
  `

  const { models, reads } = await asOperator(async (tx) => {
    await tx`set local enable_memoize = off`
    const scans = async () => {
      const [row] = await tx<{ n: string }[]>`
        select pg_stat_get_xact_numscans(
          'org_rate_overrides_resolution_idx'::regclass
        ) as n
      `
      return Number(row!.n)
    }
    const before = await scans()
    const listed = await unknownModels(tx)
    return { models: listed.models, reads: (await scans()) - before }
  })

  expect(models).toMatchObject([{ model: 'claude-unreleased-9', turns: 50 }])
  expect(reads).toBe(1)
})
