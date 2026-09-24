import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import { tokenBreakdown, type TokenCut } from '../lib/tokens'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Every Costs column's token table (Taha, 2026-09-23), against a real
// Postgres: what it has to get right is the Rate resolution, the policy and
// the one-statement shape, none of which a mock has an opinion about.

const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)
const MILLION = 1_000_000
const september = { from: '2026-09-01', to: '2026-10-01' }

let fixture: Fixture
let nextMessage = 0

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(SEED, 'utf8'))
  nextMessage = 0
})

const seedTurn = async (over: Record<string, unknown> = {}) => {
  nextMessage += 1
  await sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: 'session-1',
      message_id: `msg_${nextMessage}`,
      occurred_at: '2026-09-20T08:00:00Z',
      model: 'claude-opus-4-6',
      input_tokens: 0,
      ...over,
    })}
  `
}

const read = (cut: TokenCut, role: 'owner' | 'member' = 'owner') =>
  asRole(fixture.acme, role, (tx) =>
    tokenBreakdown(tx, fixture.acme.id, 'UTC', september, cut),
  )

const lines = (
  classes: { key: string; tokens: number; costUsd: number | null }[],
) => classes.map(({ key, tokens, costUsd }) => [key, tokens, costUsd])

test('a model: each class with its cost, cache write once, total from turn_costs', async () => {
  // claude-opus-4-6: input $5, output $25, cache read $0.50, 5m write $6.25,
  // 1h write $10, per million.
  await seedTurn({
    input_tokens: MILLION,
    output_tokens: MILLION,
    cache_read_input_tokens: MILLION,
    // The total and its split: three million written, not six.
    cache_creation_input_tokens: 3 * MILLION,
    cache_creation_5m_input_tokens: 2 * MILLION,
    cache_creation_1h_input_tokens: MILLION,
  })
  // Another day, another Session: priced on its own day, one line.
  await seedTurn({
    occurred_at: '2026-09-02T08:00:00Z',
    session_id: 'session-2',
    input_tokens: MILLION,
  })
  // Another model, not in this one's column.
  await seedTurn({ model: 'claude-opus-4-8', input_tokens: MILLION })

  const cut = await read({ kind: 'model', model: 'claude-opus-4-6' })

  expect(lines(cut.classes)).toEqual([
    ['input', 2 * MILLION, 10],
    ['output', MILLION, 25],
    ['cache_read', MILLION, 0.5],
    ['cache_write', 3 * MILLION, 22.5],
  ])
  expect(cut.tokens).toBe(7 * MILLION)
  expect(cut.costUsd).toBe(58)
  expect(cut.sessions).toBe(2)
})

test('a cut splits by model, and a Session on two models is one Session', async () => {
  await seedTurn({ input_tokens: MILLION })
  await seedTurn({ model: 'claude-opus-4-8', input_tokens: 2 * MILLION })
  // Somebody else's Turn is not in this Member's column.
  await seedTurn({
    member_id: fixture.acme.members.owner,
    input_tokens: MILLION,
  })

  const cut = await read({ kind: 'members', id: fixture.acme.members.member })

  expect(
    cut.models.map((m) => [m.model, m.tokens, m.costUsd, m.sessions]),
  ).toEqual([
    ['claude-opus-4-8', 2 * MILLION, 10, 1],
    ['claude-opus-4-6', MILLION, 5, 1],
  ])
  expect(cut.sessions).toBe(1)
  expect(cut.costUsd).toBe(15)
  expect(lines(cut.classes)[0]).toEqual(['input', 3 * MILLION, 15])
})

test('unpriced is unknown, never zero: no split, no Rate, no model', async () => {
  await seedTurn({
    input_tokens: MILLION,
    cache_creation_input_tokens: MILLION,
  })
  await seedTurn({ model: null, input_tokens: MILLION, session_id: 'bare' })

  const all = await read({ kind: 'all' })
  const opus = all.models.find((m) => m.model === 'claude-opus-4-6')!
  expect(lines(opus.classes)).toEqual([
    ['input', MILLION, 5],
    ['output', 0, 0],
    ['cache_read', 0, 0],
    ['cache_write', MILLION, null],
  ])
  // Unknown for the cut when it is unknown for any model in it.
  expect(all.classes[0]!.costUsd).toBeNull()
  expect(all.unpricedTurns).toBe(2)
  expect(all.costUsd).toBeNull()

  const bare = await read({ kind: 'model', model: null })
  expect(bare.sessions).toBe(1)
})

test('the policy decides whose Turns a column holds', async () => {
  await seedTurn({
    member_id: fixture.acme.members.owner,
    input_tokens: MILLION,
  })

  expect((await read({ kind: 'all' }, 'member')).tokens).toBe(0)
  expect((await read({ kind: 'all' }, 'owner')).tokens).toBe(MILLION)
})
