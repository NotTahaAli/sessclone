import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'
import { turnDetail, turnList } from '../lib/turns'

// Ticket 88: a ranked row opens its Turns, and a Turn opens its breakdown.
//
// Against a real Postgres with the real migrations, and read as
// `sessclone_app` rather than as the owner — the owner owns the tables, so
// Postgres applies no policy to it and a Role assertion on that connection
// proves nothing (`supabase/README.md`). Every read below goes through
// `asRole`, which is `asUser` with the fixture's id looked up.
//
// The rate list is re-applied from the seed migration itself rather than from
// a copy of its numbers, for the reason `costs.test.ts` gives: a test that
// restated the prices would pass while the migration said something else.

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

const MONTH = { from: '2026-09-01', to: '2026-10-01' }

let nextMessage = 0

/** One Turn, seeded as the owner — which is the path ingest itself takes. */
const seedTurn = async (over: Record<string, unknown> = {}) => {
  nextMessage += 1
  const [turn] = await sql<{ id: string }[]>`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: 'session-1',
      message_id: `msg_${nextMessage}`,
      occurred_at: '2026-09-20T08:00:00Z',
      model: 'claude-opus-4-6',
      service_tier: 'standard',
      ...NOTHING,
      ...over,
    })} returning id
  `
  return turn!.id
}

const project = async (key: string) => {
  const [row] = await sql<{ id: string }[]>`
    insert into projects (org_id, key) values (${fixture.acme.id}, ${key})
    returning id
  `
  return row!.id
}

// --- The list ----------------------------------------------------------

test('a cut lists only the Turns of that cut, in the period', async () => {
  const mine = await project('github.com/acme/api')
  const other = await project('github.com/acme/web')
  await seedTurn({ project_id: mine, input_tokens: 1000 })
  await seedTurn({ project_id: other, input_tokens: 1000 })
  // Inside the Project and outside the month.
  await seedTurn({ project_id: mine, occurred_at: '2026-08-20T08:00:00Z' })

  const { turns } = await asRole(fixture.acme, 'owner', (tx) =>
    turnList(
      tx,
      fixture.acme.id,
      { kind: 'projects', id: mine },
      { timezone: 'UTC', range: MONTH },
    ),
  )

  expect(turns).toHaveLength(1)
  expect(turns[0]?.projectKey).toBe('github.com/acme/api')
})

test('the absent group is a group: Turns that reported no Project', async () => {
  // `is null` rather than `is not distinct from`, because only the first can
  // use an index — and "no Project reported" is exactly the group big enough
  // on a large Org to need one.
  const somewhere = await project('github.com/acme/api')
  await seedTurn({ project_id: somewhere })
  await seedTurn({ project_id: null })

  const { turns } = await asRole(fixture.acme, 'owner', (tx) =>
    turnList(
      tx,
      fixture.acme.id,
      { kind: 'projects', id: null },
      { timezone: 'UTC', range: MONTH },
    ),
  )

  expect(turns).toHaveLength(1)
  expect(turns[0]?.projectKey).toBeNull()
})

test('the Role decides which Turns come back, and it is the policy that does', async () => {
  // The criterion ticket 88 states: "Role-scoped by the policies". Nothing in
  // `turnList` names a Member — `turns_read` resolves through
  // `sessclone_visible_member_ids()`, so the same call answers each Role
  // differently. Proven as `sessclone_app`, because the owning role is exempt
  // from every policy and would see all four here whatever the schema said.
  for (const who of ['owner', 'admin', 'manager', 'member'] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one Turn per Role, in order.
    await seedTurn({ member_id: fixture.acme.members[who] })
  }

  const seen = async (who: 'owner' | 'admin' | 'manager' | 'member') => {
    const { turns } = await asRole(fixture.acme, who, (tx) =>
      turnList(
        tx,
        fixture.acme.id,
        { kind: 'projects', id: null },
        { timezone: 'UTC', range: MONTH },
      ),
    )
    return turns.length
  }

  expect(await seen('owner')).toBe(4)
  expect(await seen('admin')).toBe(4)
  // The fixture's Manager has exactly one Member in Scope, and
  // `sessclone_visible_member_ids()` unions their own membership in — so a
  // Manager sees their Scope *and* themselves, which is two here and is the
  // database's answer rather than this page's.
  expect(await seen('manager')).toBe(2)
  expect(await seen('member')).toBe(1)
})

test('another Org’s Turns are not reachable by asking for its id', async () => {
  await sql`
    insert into turns ${sql({
      org_id: fixture.globex.id,
      member_id: fixture.globex.members.member,
      session_id: 'session-globex',
      message_id: 'msg_globex',
      occurred_at: '2026-09-20T08:00:00Z',
      model: 'claude-opus-4-6',
      ...NOTHING,
    })}
  `

  const { turns } = await asRole(fixture.acme, 'owner', (tx) =>
    turnList(
      tx,
      fixture.globex.id,
      { kind: 'projects', id: null },
      { timezone: 'UTC', range: MONTH },
    ),
  )

  expect(turns).toEqual([])
})

test('the cursor pages without repeating or skipping a Turn', async () => {
  for (let index = 0; index < 5; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- seeded in time order.
    await seedTurn({
      occurred_at: `2026-09-2${index}T08:00:00Z`,
      input_tokens: 1000,
    })
  }

  const first = await asRole(fixture.acme, 'owner', (tx) =>
    turnList(
      tx,
      fixture.acme.id,
      { kind: 'projects', id: null },
      { timezone: 'UTC', range: MONTH, limit: 2 },
    ),
  )
  expect(first.more).toBe(true)

  const second = await asRole(fixture.acme, 'owner', (tx) =>
    turnList(
      tx,
      fixture.acme.id,
      { kind: 'projects', id: null },
      {
        timezone: 'UTC',
        range: MONTH,
        limit: 2,
        before: {
          occurredAt: first.turns[1]!.occurredAt,
          id: first.turns[1]!.id,
        },
      },
    ),
  )

  const ids = [...first.turns, ...second.turns].map((turn) => turn.id)
  expect(new Set(ids).size).toBe(4)
  // Newest first, and strictly decreasing across the boundary.
  expect(ids).toEqual(ids.toSorted((a, b) => Number(b) - Number(a)))
})

test('a cut reaches an index rather than scanning every Turn', async () => {
  // The ticket's own criterion — "the reads are index-backed; no query in a
  // loop" — and the failure it guards against is a predicate that cannot use
  // one. `is not distinct from` is the obvious spelling of the absent group
  // and is exactly that predicate, so this would have caught it.
  //
  // Seeded so the filter is worth an index: on a handful of rows a sequential
  // scan is the right plan and the assertion would be about the fixture.
  const mine = await project('github.com/acme/api')
  await sql`
    insert into turns (
      org_id, member_id, project_id, session_id, message_id, occurred_at,
      model, input_tokens
    )
    select ${fixture.acme.id}, ${fixture.acme.members.member},
           case when g % 50 = 0 then ${mine}::uuid else null end,
           'session-bulk', 'bulk_' || g,
           timestamptz '2026-09-20 08:00Z' - g * interval '1 minute',
           'claude-opus-4-6', 1000
      from generate_series(1, 5000) g
  `
  await sql`analyze turns`

  const plan = await sql<Record<string, string>[]>`
    explain (costs off)
      select turn.id
        from turn_costs cost
        join turns turn on turn.id = cost.turn_id
       where cost.org_id = ${fixture.acme.id}
         and turn.org_id = ${fixture.acme.id}
         and turn.occurred_at >= '2026-09-01T00:00:00Z'
         and turn.occurred_at < '2026-10-01T00:00:00Z'
         and turn.project_id = ${mine}
       order by turn.occurred_at desc, turn.id desc
       limit 51
  `
  const text = plan.map((row) => Object.values(row)[0]).join('\n')

  expect(text).toMatch(/turns_(project|org)_occurred_at_idx/)
  expect(text).not.toMatch(/Seq Scan on turns/)
})

// --- One Turn, quantity by quantity ------------------------------------

test('every recorded quantity is named, with its own cost', async () => {
  // A million of each token class and a thousand of each server-tool class, so
  // each line is the published price itself and a class priced off the wrong
  // row is visible rather than plausible. `claude-opus-4-6` is $5 in, $25 out,
  // $0.50 cache read, $6.25 and $10 for the two cache writes; a web search is
  // $10 per 1,000 and a web fetch is free.
  const id = await seedTurn({
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    thinking_tokens: 400_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 2_000_000,
    cache_creation_5m_input_tokens: 1_000_000,
    cache_creation_1h_input_tokens: 1_000_000,
    web_search_requests: 1_000,
    web_fetch_requests: 1_000,
  })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    turnDetail(tx, fixture.acme.id, id),
  )

  const by = new Map(detail!.quantities.map((q) => [q.key, q]))
  expect([...by.keys()]).toEqual([
    'input',
    'output',
    'thinking',
    'cache_read',
    'cache_write_5m',
    'cache_write_1h',
    'web_search',
    'web_fetch',
  ])

  expect(by.get('input')!.costUsd).toBeCloseTo(5, 10)
  expect(by.get('output')!.costUsd).toBeCloseTo(25, 10)
  expect(by.get('cache_read')!.costUsd).toBeCloseTo(0.5, 10)
  expect(by.get('cache_write_5m')!.costUsd).toBeCloseTo(6.25, 10)
  expect(by.get('cache_write_1h')!.costUsd).toBeCloseTo(10, 10)
  expect(by.get('web_search')!.costUsd).toBeCloseTo(10, 10)
  expect(by.get('web_fetch')!.costUsd).toBeCloseTo(0, 10)

  // Thinking is a subset of output, not an addition to it (the schema says
  // so), so it is listed with its quantity and no cost of its own.
  expect(by.get('thinking')).toMatchObject({
    quantity: 400_000,
    costUsd: null,
    unpriced: false,
    note: 'already counted inside output',
  })
})

test('the lines add up to what the rest of the product calls this Turn', async () => {
  // The guard that makes the second arithmetic path safe. `turn_costs` is what
  // every other surface sums; this table resolves the same seven Rates through
  // `sessclone_resolve_rate` and multiplies them here. If the two ever
  // disagree — a divisor, a modifier, the order of the division — the reader
  // is shown a breakdown that does not add up to its own total, and this is
  // where that surfaces.
  const id = await seedTurn({
    input_tokens: 12_345,
    output_tokens: 6_789,
    cache_read_input_tokens: 999_999,
    cache_creation_input_tokens: 4_321,
    cache_creation_5m_input_tokens: 4_321,
    web_search_requests: 7,
    // The batch tier halves every token class and leaves the two server-tool
    // classes alone, so the multiplier is in play rather than sitting at 1 —
    // which is the case a per-line arithmetic bug would otherwise hide. (Fast
    // mode would not do it here: it needs an Opus of generation 4.08 or later
    // and this model is 4.06.)
    service_tier: 'batch',
  })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    turnDetail(tx, fixture.acme.id, id),
  )

  expect(detail!.facts.multiplier).toBe(0.5)

  const summed = detail!.quantities.reduce(
    (total, quantity) => total + (quantity.costUsd ?? 0),
    0,
  )
  expect(summed).toBeCloseTo(detail!.row.costUsd!, 10)
})

test('a quantity with no Rate reads as unpriced and never as zero', async () => {
  // ADR 0002's rule, and the one ticket 42 had to fix once already: a zero
  // understates while looking authoritative, which on this page is the worst
  // failure available.
  const id = await seedTurn({ model: 'claude-not-a-model', input_tokens: 100 })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    turnDetail(tx, fixture.acme.id, id),
  )

  const input = detail!.quantities.find((q) => q.key === 'input')
  expect(input).toMatchObject({ quantity: 100, unpriced: true, costUsd: null })
  expect(input!.costUsd).not.toBe(0)
  expect(detail!.row.costUsd).toBeNull()
  expect(detail!.row.unpriced).toBe(true)
})

test('a cache-write total with no split is its own unpriced line', async () => {
  // `packages/shared/src/turns.ts` allows a capture to state the total and no
  // split, and pricing the shortfall at the 5m rate would be a guess. The
  // shortfall is therefore a line of its own, unpriced, rather than money that
  // silently disappears from the breakdown.
  const id = await seedTurn({
    cache_creation_input_tokens: 1_000_000,
    cache_creation_5m_input_tokens: 250_000,
    cache_creation_1h_input_tokens: 250_000,
  })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    turnDetail(tx, fixture.acme.id, id),
  )

  const unsplit = detail!.quantities.find(
    (q) => q.key === 'cache_write_unsplit',
  )
  expect(unsplit).toMatchObject({
    quantity: 500_000,
    unpriced: true,
    costUsd: null,
  })
  // And the Turn as a whole is unpriced, which is what `turn_costs` already
  // says — the line and the total agree.
  expect(detail!.row.unpriced).toBe(true)
  expect(detail!.row.costUsd).toBeNull()
})

test('a class the Turn consumed nothing of is zero, not unpriced', async () => {
  // The other half of the same rule. An absent Rate on a zero counter is not a
  // gap: it contributes nothing either way, and calling it unpriced would put
  // a warning on every Turn that did not happen to fetch a web page.
  const id = await seedTurn({ input_tokens: 1_000_000 })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    turnDetail(tx, fixture.acme.id, id),
  )

  expect(detail!.quantities.find((q) => q.key === 'web_fetch')).toMatchObject({
    quantity: 0,
    unpriced: false,
    costUsd: 0,
  })
  expect(detail!.row.unpriced).toBe(false)
})

test('a Turn outside the viewer’s set is no row, not a refusal', async () => {
  // `turns_read` is the whole authorisation — the statement filters on the id
  // and the Org and names no Member. A Turn somebody may not see comes back
  // null, which the page answers as a 404: a distinguishable refusal would
  // confirm that it exists.
  const id = await seedTurn({ member_id: fixture.acme.members.owner })

  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      turnDetail(tx, fixture.acme.id, id),
    ),
  ).toBeNull()
  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      turnDetail(tx, fixture.acme.id, id),
    ),
  ).toBeNull()
  expect(
    await asUser(fixture.stranger.userId, (tx) =>
      turnDetail(tx, fixture.acme.id, id),
    ),
  ).toBeNull()
})

test('the dimensions the Turn recorded come back as recorded, nulls and all', async () => {
  // Every one of these columns is nullable because a transcript may state none
  // of them, and the surface says "not reported" rather than dropping the row:
  // "we have no value" and "the value is none" are different answers.
  const id = await seedTurn({
    service_tier: 'batch',
    client_version: '2.1.0',
    spawn_depth: 2,
    agent_id: 'agent-7',
    complete: false,
    reported_cost_usd: 0.42,
  })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    turnDetail(tx, fixture.acme.id, id),
  )

  expect(detail!.facts).toMatchObject({
    serviceTier: 'batch',
    clientVersion: '2.1.0',
    spawnDepth: 2,
    speed: null,
    inferenceGeo: null,
    cloudSessionHandle: null,
    reportedCostUsd: 0.42,
  })
  expect(detail!.row.complete).toBe(false)
  expect(detail!.row.agentId).toBe('agent-7')
})
