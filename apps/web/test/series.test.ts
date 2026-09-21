import { readFileSync } from 'node:fs'

import postgres from 'postgres'

import { beforeEach, describe, expect, test } from 'vitest'

import {
  addDays,
  currentMonth,
  dailySpend,
  spendSeries,
  type SpendRow,
} from '../lib/series'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 52. Two halves, tested at the level each one breaks at.
//
// The read is against a real Postgres, because what it has to get right is
// the timezone bucket and the policy — neither of which a mock has an opinion
// about. The roll-up is pure and is tested directly, because what it has to
// get right is arithmetic and ordering over rows, and proving that through a
// database would be the slow duplicate `AGENTS.md` warns about.

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

const september = { from: '2026-09-01', to: '2026-10-01' }

describe('the read', () => {
  test('buckets a Turn on the Org day, not the UTC day', async () => {
    // 23:40 in New York on the 20th is 03:40 UTC on the 21st. An Org that
    // measures its days from New York spent this on the 20th, and a chart
    // that drew it on the 21st would disagree with the price the same Turn
    // was charged at, since `turn_costs` reads the same setting.
    await sql`update orgs set timezone = 'America/New_York' where id = ${fixture.acme.id}`
    await seedTurn({
      occurred_at: '2026-09-21T03:40:00Z',
      input_tokens: MILLION,
    })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      dailySpend(tx, fixture.acme.id, 'America/New_York', september),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.date).toBe('2026-09-20')
  })

  test('counts an unpriced Turn without adding it to the cost', async () => {
    await seedTurn({ input_tokens: MILLION })
    await seedTurn({ model: 'claude-unreleased-9', input_tokens: MILLION })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      dailySpend(tx, fixture.acme.id, 'UTC', september),
    )

    const unknown = rows.find((row) => row.model === 'claude-unreleased-9')
    expect(unknown).toMatchObject({ costUsd: null, unpricedTurns: 1, turns: 1 })
    expect(rows.find((row) => row.model === 'claude-opus-4-6')).toMatchObject({
      costUsd: 5,
      unpricedTurns: 0,
    })
  })

  test('sums the four reported token classes and no subset twice', async () => {
    // The 5m and 1h splits are subsets of the reported cache-creation total,
    // and thinking is a subset of output. A sum that added them would report
    // 700 here rather than 400.
    await seedTurn({
      input_tokens: 100,
      output_tokens: 100,
      thinking_tokens: 40,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 100,
      cache_creation_5m_input_tokens: 60,
      cache_creation_1h_input_tokens: 40,
    })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      dailySpend(tx, fixture.acme.id, 'UTC', september),
    )

    expect(rows[0]!.tokens).toBe(400)
  })

  test('excludes a Turn outside the range, at the range edge', async () => {
    // Half-open: the first instant of October belongs to October.
    await seedTurn({ occurred_at: '2026-09-30T23:59:59Z' })
    await seedTurn({ occurred_at: '2026-10-01T00:00:00Z' })

    const rows = await asRole(fixture.acme, 'owner', (tx) =>
      dailySpend(tx, fixture.acme.id, 'UTC', september),
    )

    expect(rows.map((row) => row.date)).toEqual(['2026-09-30'])
  })

  test('shows a Member their own Turns and not the Org', async () => {
    // The policy does this, not the query: the same call, a different viewer.
    await seedTurn({ member_id: fixture.acme.members.member })
    await seedTurn({ member_id: fixture.acme.members.owner })

    const asOwner = await asRole(fixture.acme, 'owner', (tx) =>
      dailySpend(tx, fixture.acme.id, 'UTC', september),
    )
    const asMember = await asRole(fixture.acme, 'member', (tx) =>
      dailySpend(tx, fixture.acme.id, 'UTC', september),
    )

    expect(asOwner[0]!.turns).toBe(2)
    expect(asMember[0]!.turns).toBe(1)
  })

  test('returns nothing for another Org, id or no id', async () => {
    await seedTurn({ input_tokens: MILLION })

    const rows = await asRole(fixture.globex, 'owner', (tx) =>
      dailySpend(tx, fixture.acme.id, 'UTC', september),
    )

    expect(rows).toEqual([])
  })

  test('reads the range through the index', async () => {
    // The measurement `AGENTS.md` asks to be recorded, kept as a test so it
    // stays true: the range has to reach `turns_org_occurred_at_idx` rather
    // than pricing the deployment and discarding it. Seeded so the filter is
    // selective enough that a sequential scan is the wrong plan.
    const rows = Array.from({ length: 400 }, (_, index) => ({
      org_id: fixture.globex.id,
      member_id: fixture.globex.members.owner,
      session_id: 'bulk',
      message_id: `bulk_${index}`,
      occurred_at: '2026-06-01T00:00:00Z',
      model: 'claude-opus-4-6',
      input_tokens: 1000,
    }))
    await sql`insert into turns ${sql(rows)}`
    await seedTurn({ input_tokens: MILLION })
    await sql`analyze turns`

    // Explained as the statement `dailySpend` actually issues, captured from
    // the driver rather than retyped here — a hand-written copy proves only
    // that the copy is indexed, and stays green when the real query loses its
    // range.
    // Typed as the driver hands them over, so the captured statement goes
    // back into `explain` with no cast in between.
    const seen: { query: string; params: postgres.ParameterOrJSON<never>[] }[] =
      []
    const watched = postgres(process.env.APP_DATABASE_URL!, {
      debug: (_connection, query, params) => seen.push({ query, params }),
    })

    try {
      await watched.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: fixture.acme.users.owner })}, true)`
        await dailySpend(tx, fixture.acme.id, 'UTC', september)
      })

      const issued = seen.find((entry) => entry.query.includes('turn_costs'))
      expect(issued).toBeDefined()

      const plan = await asRole(fixture.acme, 'owner', async (tx) => {
        const explained = await tx.unsafe<{ 'QUERY PLAN': string }[]>(
          `explain ${issued!.query}`,
          issued!.params,
        )
        return explained.map((line) => line['QUERY PLAN']).join('\n')
      })

      expect(plan).toMatch(/turns_org_occurred_at_idx/)
    } finally {
      await watched.end()
    }
  })
})

/** One row, with only what a case cares about spelled out. */
const row = (over: Partial<SpendRow> = {}): SpendRow => ({
  date: '2026-09-01',
  model: 'claude-opus-4-6',
  costUsd: 1,
  tokens: 10,
  turns: 1,
  unpricedTurns: 0,
  ...over,
})

describe('the roll-up', () => {
  test('the totals count every row, including one outside the drawn days', () => {
    // The bars are drawn from the range's dates and the totals are summed
    // from the rows, because the two boundaries are different expressions for
    // one edge — `at time zone` in SQL against date strings here — and they
    // can disagree in a zone whose DST transition lands on midnight. Money
    // that fell out of the loop would vanish from the four figures.
    const series = spendSeries(
      [row({ date: '2026-09-01' }), row({ date: '2026-08-31', costUsd: 4 })],
      { from: '2026-09-01', to: '2026-09-03' },
    )

    expect(series.days).toHaveLength(2)
    expect(series.costUsd).toBe(5)
    expect(series.turns).toBe(2)
  })

  test('draws every day in the range, including the empty ones', () => {
    const series = spendSeries([row({ date: '2026-09-03' })], {
      from: '2026-09-01',
      to: '2026-09-05',
    })

    expect(series.days.map((day) => day.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ])
    expect(series.days[0]!.segments).toEqual([])
    expect(series.days[2]!.costUsd).toBe(1)
  })

  test('gives the five largest models a slot and rolls the rest into Other', () => {
    const models = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const series = spendSeries(
      models.map((model, index) =>
        row({ model, costUsd: models.length - index }),
      ),
      { from: '2026-09-01', to: '2026-09-02' },
    )

    expect(series.series.map((entry) => [entry.label, entry.slot])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
      ['e', 5],
      ['Other', 'other'],
    ])
    // f and g, 2 + 1, as one block rather than two.
    expect(series.series[5]!.costUsd).toBe(3)
    expect(
      series.days[0]!.segments.filter((segment) => segment.slot === 'other'),
    ).toHaveLength(1)
  })

  test('keeps a model in its slot across days', () => {
    // The failure this prevents is a chart that recolours itself per bar,
    // where the reader compares two different models by their colour.
    const series = spendSeries(
      [
        row({ date: '2026-09-01', model: 'small', costUsd: 1 }),
        row({ date: '2026-09-01', model: 'big', costUsd: 10 }),
        row({ date: '2026-09-02', model: 'small', costUsd: 20 }),
      ],
      { from: '2026-09-01', to: '2026-09-03' },
    )

    const slotOf = (day: number, label: string) =>
      series.days[day]!.segments.find((segment) => segment.label === label)
        ?.slot

    // `small` is the larger over the range and takes slot 1 on both days,
    // even though `big` outspends it on the first — the slot follows the
    // range's ranking, not each bar's.
    expect(slotOf(0, 'small')).toBe(1)
    expect(slotOf(1, 'small')).toBe(1)
    expect(slotOf(0, 'big')).toBe(2)
  })

  test('counts unpriced Turns without adding them to the total', () => {
    const series = spendSeries(
      [
        row({ costUsd: 3 }),
        row({ model: 'unknown', costUsd: null, unpricedTurns: 1 }),
      ],
      { from: '2026-09-01', to: '2026-09-02' },
    )

    expect(series.costUsd).toBe(3)
    expect(series.unpricedTurns).toBe(1)
    expect(series.turns).toBe(2)
    // An unpriced model contributes no block, since it has no money to draw.
    expect(series.days[0]!.segments).toHaveLength(1)
  })

  test('names a Turn with no model rather than dropping it', () => {
    const series = spendSeries([row({ model: null })], {
      from: '2026-09-01',
      to: '2026-09-02',
    })

    expect(series.series[0]!.label).toBe('No model reported')
  })
})

describe('the range', () => {
  test('defaults to the calendar month in the Org timezone', () => {
    // 00:30 UTC on 1 October is still September in Los Angeles, and the Org's
    // month is the one its bill is drawn on.
    expect(
      currentMonth('America/Los_Angeles', new Date('2026-10-01T00:30:00Z')),
    ).toEqual({ from: '2026-09-01', to: '2026-10-01' })
  })

  test('rolls over the year', () => {
    expect(currentMonth('UTC', new Date('2026-12-14T00:00:00Z'))).toEqual({
      from: '2026-12-01',
      to: '2027-01-01',
    })
  })

  test('adds days across a month boundary', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })
})
