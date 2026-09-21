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
  expect(operatorSees).toMatchObject([
    { model: 'claude-unreleased-9', turns: 2 },
  ])

  // An Owner of the Org whose Turns those are still gets nothing: the list is
  // deployment-wide, and the flag is not a Role.
  expect(
    await asUser(fixture.acme.users.owner, (tx) => unknownModels(tx)),
  ).toEqual([])
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
