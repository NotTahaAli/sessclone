import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// `turn_rollups` (`…_turn_rollups.sql`): the dashboard sums rollup rows instead
// of Turns, so every figure it shows is only right while the rollups say
// exactly what the Turns say. Each test below compares the two after a
// different kind of write — the comparison, not a hand-computed number, is
// the claim.

const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(SEED, 'utf8'))
})

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

let nextMessage = 0

const turn = (over: Record<string, unknown> = {}) => {
  nextMessage += 1
  return {
    org_id: fixture.acme.id,
    member_id: fixture.acme.members.member,
    session_id: 'session-1',
    agent_id: null,
    message_id: `msg_${nextMessage}`,
    occurred_at: '2026-09-20T08:00:00Z',
    model: 'claude-opus-4-6',
    service_tier: 'standard',
    speed: null,
    inference_geo: null,
    ...NOTHING,
    ...over,
  }
}

/**
 * A spread of Turns covering every input the rollup key or the price reads:
 * several models (one with no Rate), the three modifiers, each counter alone,
 * a cache-write total with no split, Agent Runs, both Orgs, and instants
 * either side of a midnight that only some timezones put them across.
 */
const variety = () => [
  turn({ input_tokens: 1000, output_tokens: 500 }),
  turn({ input_tokens: 10, occurred_at: '2026-09-20T23:30:00Z' }),
  turn({ output_tokens: 7, occurred_at: '2026-09-21T00:30:00Z' }),
  turn({ model: 'claude-opus-4-8', speed: 'fast', input_tokens: 300 }),
  turn({ model: 'claude-opus-4-8', inference_geo: 'us', output_tokens: 40 }),
  turn({ service_tier: 'batch', cache_read_input_tokens: 9000 }),
  turn({
    cache_creation_input_tokens: 600,
    cache_creation_5m_input_tokens: 400,
    cache_creation_1h_input_tokens: 200,
  }),
  // A total with no split: unpriced, and its own shape.
  turn({ cache_creation_input_tokens: 50 }),
  turn({ web_search_requests: 3, web_fetch_requests: 2 }),
  turn({ model: 'no-such-model', input_tokens: 5 }),
  turn({ model: null, output_tokens: 5 }),
  turn({ agent_id: 'agent-a', input_tokens: 11 }),
  turn({ agent_id: 'agent-a', input_tokens: 12, thinking_tokens: 3 }),
  turn({
    session_id: 'session-2',
    member_id: fixture.acme.members.owner,
    input_tokens: 99,
  }),
  turn({
    org_id: fixture.globex.id,
    member_id: fixture.globex.members.member,
    input_tokens: 77,
  }),
]

/**
 * The rollups, and the same groups computed straight from `turns` and priced
 * by `turn_costs`, as two sorted lists of plain values. Grouped by the columns
 * a read can filter or group on, plus the Org-local day.
 */
const bothWays = async () => {
  const fromRollups = await sql`
    select org_id, member_id, session_id, agent_id, project_id, device_id,
           model, day::text,
           sum(turns)::int as turns,
           sum(input_tokens)::int as input,
           sum(output_tokens)::int as output,
           sum(cache_read_input_tokens)::int as cache_read,
           sum(cache_creation_input_tokens)::int as cache_write,
           sum(thinking_tokens)::int as thinking,
           sum(web_search_requests)::int as searches,
           sum(cost_usd)::numeric(20, 12)::text as cost,
           sum(unpriced_turns)::int as unpriced,
           min(first_at) as first_at, max(last_at) as last_at
      from turn_rollup_costs
     group by 1, 2, 3, 4, 5, 6, 7, 8
     order by 1, 2, 3, 4, 5, 6, 7, 8
  `
  const fromTurns = await sql`
    select turn.org_id, turn.member_id, turn.session_id, turn.agent_id,
           turn.project_id, turn.device_id, turn.model,
           (turn.occurred_at at time zone org.timezone)::date::text as day,
           count(*)::int as turns,
           sum(turn.input_tokens)::int as input,
           sum(turn.output_tokens)::int as output,
           sum(turn.cache_read_input_tokens)::int as cache_read,
           sum(turn.cache_creation_input_tokens)::int as cache_write,
           sum(turn.thinking_tokens)::int as thinking,
           sum(turn.web_search_requests)::int as searches,
           sum(cost.cost_usd)::numeric(20, 12)::text as cost,
           (count(*) filter (where cost.unpriced))::int as unpriced,
           min(turn.occurred_at) as first_at, max(turn.occurred_at) as last_at
      from turns turn
      join turn_costs cost on cost.turn_id = turn.id
      join orgs org on org.id = turn.org_id
     group by 1, 2, 3, 4, 5, 6, 7, 8
     order by 1, 2, 3, 4, 5, 6, 7, 8
  `
  return { fromRollups: [...fromRollups], fromTurns: [...fromTurns] }
}

const expectAgreement = async () => {
  const { fromRollups, fromTurns } = await bothWays()
  expect(fromTurns.length).toBeGreaterThan(0)
  expect(fromRollups).toEqual(fromTurns)
}

test('an insert adds its Turns to the rollups, priced as turn_costs prices them', async () => {
  await sql`insert into turns ${sql(variety())}`

  await expectAgreement()
})

test('inserts one at a time land in the same groups as one batch', async () => {
  for (const row of variety()) {
    // oxlint-disable-next-line no-await-in-loop -- one statement per Turn is the case.
    await sql`insert into turns ${sql(row)}`
  }

  await expectAgreement()
})

test('a Turn sent twice is counted once', async () => {
  const rows = variety()
  await sql`insert into turns ${sql(rows)}`
  // Ingest's own statement: the duplicate is skipped, so it never reaches the
  // trigger's new rows.
  await sql`
    insert into turns ${sql(rows)}
    on conflict (member_id, session_id, agent_id, message_id) do nothing
  `

  await expectAgreement()
})

test('a Device deleted under its Turns moves them to the no-Device group', async () => {
  const [device] = await sql<{ id: string }[]>`
    insert into devices (member_id, key)
    values (${fixture.acme.members.member}, 'laptop') returning id
  `
  await sql`
    insert into turns ${sql(variety().map((row) => ({ ...row, device_id: device!.id })))}
  `

  // `on delete set null` is an update of `turns`.
  await sql`delete from devices where id = ${device!.id}`

  const [left] = await sql<{ count: string }[]>`
    select count(*) from turn_rollups where device_id is not null
  `
  expect(Number(left!.count)).toBe(0)
  await expectAgreement()
})

test('deleted Turns leave the rollups, and an emptied group goes', async () => {
  await sql`insert into turns ${sql(variety())}`

  await sql`delete from turns where session_id = 'session-2'`
  await sql`delete from turns where agent_id = 'agent-a' and input_tokens = 11`

  const [gone] = await sql<{ count: string }[]>`
    select count(*) from turn_rollups where session_id = 'session-2'
  `
  expect(Number(gone!.count)).toBe(0)
  await expectAgreement()
})

test('changing the Org timezone moves its Turns to their new local days', async () => {
  await sql`insert into turns ${sql(variety())}`

  // 23:30Z on the 20th is the 21st in Karachi.
  await sql`update orgs set timezone = 'Asia/Karachi' where id = ${fixture.acme.id}`

  const days = await sql<{ day: string }[]>`
    select distinct day::text from turn_rollups
     where org_id = ${fixture.acme.id} order by 1
  `
  expect(days.map((row) => row.day)).toEqual(['2026-09-20', '2026-09-21'])
  const [late] = await sql<{ day: string }[]>`
    select day::text from turn_rollups
     where org_id = ${fixture.acme.id} and input_tokens = 10
  `
  expect(late!.day).toBe('2026-09-21')
  await expectAgreement()
})

test('a Rate added later reprices the rollups with no rewrite', async () => {
  await sql`insert into turns ${sql(variety())}`

  await sql`
    insert into rates (model, class, price_usd, effective_from, source)
    values ('no-such-model', 'input', 3, '2026-01-01', 'test')
  `

  await expectAgreement()
})

test('a Member reads their own rollups and an Owner reads the Org’s', async () => {
  await sql`insert into turns ${sql(variety())}`

  const total = (role: 'member' | 'owner' | 'admin') =>
    asRole(fixture.acme, role, async (tx) => {
      const [row] = await tx<{ turns: string | null }[]>`
        select sum(turns) as turns from turn_rollups
      `
      return Number(row!.turns ?? 0)
    })
  const turnsOf = (role: 'member' | 'owner' | 'admin') =>
    asRole(fixture.acme, role, async (tx) => {
      const [row] = await tx<{ count: string }[]>`select count(*) from turns`
      return Number(row!.count)
    })

  expect(await total('member')).toBe(await turnsOf('member'))
  expect(await total('owner')).toBe(await turnsOf('owner'))
  expect(await total('owner')).toBeGreaterThan(await total('member'))
  expect(await total('admin')).toBe(await turnsOf('admin'))
})

test('the history window hides the same days from rollups as from Turns', async () => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, history_days, sort_order)
    values ('ninety', 'T', 10, 90, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${fixture.acme.id}, ${tier!.id}, 'active')
  `
  const now = Date.now()
  const daysAgo = (days: number) =>
    new Date(now - days * 86_400_000).toISOString()
  await sql`
    insert into turns ${sql([
      turn({ occurred_at: daysAgo(1), input_tokens: 1 }),
      turn({ occurred_at: daysAgo(89), input_tokens: 2 }),
      turn({ occurred_at: daysAgo(91), input_tokens: 4 }),
      turn({ occurred_at: daysAgo(200), input_tokens: 8 }),
    ])}
  `

  const [seen] = await asRole(
    fixture.acme,
    'member',
    (tx) => tx<{ rollups: string; turns: string }[]>`
    select (select sum(input_tokens) from turn_rollups) as rollups,
           (select sum(input_tokens) from turns) as turns
  `,
  )
  expect(Number(seen!.rollups)).toBe(Number(seen!.turns))
  expect(Number(seen!.turns)).toBe(3)
})

test('the dashboard role cannot write rollups or call the helpers', async () => {
  await expect(
    asRole(fixture.acme, 'owner', (tx) => tx`delete from turn_rollups`),
  ).rejects.toThrow(/permission denied/)
  await expect(
    asRole(
      fixture.acme,
      'owner',
      (tx) => tx`select sessclone_rollup_recompute('{}', '{}')`,
    ),
  ).rejects.toThrow(/permission denied/)
})
