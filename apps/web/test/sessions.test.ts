import { readFileSync } from 'node:fs'

import { beforeEach, expect, test } from 'vitest'

import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
  type FixtureRole,
} from './harness'
import { setArchivalEnabled, setProjectArchival } from '../lib/archival'
import {
  archivalReason,
  sessionDetail,
  sessionFilters,
  sessionList,
  sessionModels,
  sessionTranscripts,
} from '../lib/sessions'

// Ticket 86: the Sessions list, and what one Session did.
//
// Read as `sessclone_app` rather than as the owner, because the owner owns the
// tables and Postgres applies no policy to it — a Role assertion on that
// connection proves nothing (`supabase/README.md`). The ticket asks for
// exactly this: "Role scoping proven against the policies as the unprivileged
// role, not through the UI".

const SEED = new URL(
  '../../../supabase/migrations/20260921090000_rate_seed.sql',
  import.meta.url,
)

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  await sql.unsafe(readFileSync(SEED, 'utf8'))
})

const MONTH = { from: '2026-09-01', to: '2026-10-01' }

let nextMessage = 0

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
      input_tokens: 1_000_000,
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

const endSession = (sessionId: string, at: string, over = {}) => sql`
  insert into session_events ${sql({
    org_id: fixture.acme.id,
    member_id: fixture.acme.members.member,
    session_id: sessionId,
    kind: 'session_end',
    occurred_at: at,
    ...over,
  })}
`

const list = (who: 'owner' | 'admin' | 'manager' | 'member', filter = {}) =>
  asRole(fixture.acme, who, (tx) =>
    sessionList(tx, fixture.acme.id, 'UTC', MONTH, filter),
  )

// --- The list ----------------------------------------------------------

test('a Session is one row, whatever it is made of', async () => {
  const api = await project('github.com/acme/api')
  await seedTurn({ project_id: api, occurred_at: '2026-09-20T08:00:00Z' })
  await seedTurn({ project_id: api, occurred_at: '2026-09-20T08:30:00Z' })
  // A subagent reports under the same session id with an agent_id of its own
  // (finding 74), so it groups rather than becoming a second Session.
  await seedTurn({
    project_id: api,
    agent_id: 'agent-1',
    occurred_at: '2026-09-20T08:10:00Z',
  })
  await endSession('session-1', '2026-09-20T09:00:00Z')

  const { sessions } = await list('owner')

  expect(sessions).toHaveLength(1)
  expect(sessions[0]).toMatchObject({
    sessionId: 'session-1',
    projectKey: 'github.com/acme/api',
    memberEmail: 'member@acme.test',
    turns: 3,
    agentRuns: 1,
    startedAt: '2026-09-20T08:00:00.000Z',
    endedAt: '2026-09-20T09:00:00.000Z',
  })
  // $5 per MTok in, three Turns of a million input tokens each.
  expect(sessions[0]!.costUsd).toBeCloseTo(15, 10)
})

test('a Session with no end marker says so rather than guessing one', async () => {
  // Ticket 05: `SessionEnd` fires about 180ms after SIGTERM and not at all
  // under SIGKILL, so this is the ordinary state for a killed session. Filling
  // the gap with the last Turn's time would be inventing an ending.
  await seedTurn({ occurred_at: '2026-09-20T08:00:00Z' })

  const { sessions } = await list('owner')

  expect(sessions[0]!.endedAt).toBeNull()
  expect(sessions[0]!.lastTurnAt).toBe('2026-09-20T08:00:00.000Z')
})

test('a subagent’s own end marker does not end the Session', async () => {
  // An Agent Run reports its `session_end` under the parent's session id. The
  // Session ends when the Session ends, not when the last subagent stopped.
  await seedTurn({})
  await endSession('session-1', '2026-09-20T08:20:00Z', { agent_id: 'agent-1' })

  const { sessions } = await list('owner')

  expect(sessions[0]!.endedAt).toBeNull()
})

test('the Role decides which Sessions come back, and it is the policy that does', async () => {
  for (const who of ['owner', 'admin', 'manager', 'member'] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one Session per Role.
    await seedTurn({
      member_id: fixture.acme.members[who],
      session_id: `session-${who}`,
    })
  }

  expect((await list('owner')).sessions).toHaveLength(4)
  expect((await list('admin')).sessions).toHaveLength(4)
  // A Manager sees their Scope and their own membership, which the fixture
  // makes two — `sessclone_visible_member_ids()` says so, not this page.
  expect(
    (await list('manager')).sessions.map((s) => s.sessionId).toSorted(),
  ).toEqual(['session-manager', 'session-member'])
  expect((await list('member')).sessions.map((s) => s.sessionId)).toEqual([
    'session-member',
  ])
})

test('another Org’s Sessions are not reachable by asking for its id', async () => {
  await sql`
    insert into turns ${sql({
      org_id: fixture.globex.id,
      member_id: fixture.globex.members.member,
      session_id: 'session-globex',
      message_id: 'msg_globex',
      occurred_at: '2026-09-20T08:00:00Z',
      model: 'claude-opus-4-6',
      input_tokens: 10,
    })}
  `

  const { sessions } = await asRole(fixture.acme, 'owner', (tx) =>
    sessionList(tx, fixture.globex.id, 'UTC', MONTH),
  )

  expect(sessions).toEqual([])
  expect(
    (
      await asUser(fixture.stranger.userId, (tx) =>
        sessionList(tx, fixture.acme.id, 'UTC', MONTH),
      )
    ).sessions,
  ).toEqual([])
})

test('the list filters by Project and by person', async () => {
  const api = await project('github.com/acme/api')
  const web = await project('github.com/acme/web')
  await seedTurn({ project_id: api, session_id: 'on-api' })
  await seedTurn({ project_id: web, session_id: 'on-web' })
  await seedTurn({ project_id: null, session_id: 'nowhere' })
  await seedTurn({
    project_id: api,
    session_id: 'someone-else',
    member_id: fixture.acme.members.admin,
  })

  expect(
    (await list('owner', { projectId: api })).sessions
      .map((s) => s.sessionId)
      .toSorted(),
  ).toEqual(['on-api', 'someone-else'])

  // `null` is the Sessions that ran outside a repository — a group, not a gap.
  expect(
    (await list('owner', { projectId: null })).sessions.map((s) => s.sessionId),
  ).toEqual(['nowhere'])

  expect(
    (
      await list('owner', { memberId: fixture.acme.members.admin })
    ).sessions.map((s) => s.sessionId),
  ).toEqual(['someone-else'])
})

test('the cursor pages without repeating or skipping a Session', async () => {
  for (let index = 0; index < 5; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- seeded in time order.
    await seedTurn({
      session_id: `session-${index}`,
      occurred_at: `2026-09-2${index}T08:00:00Z`,
    })
  }

  const first = await asRole(fixture.acme, 'owner', (tx) =>
    sessionList(tx, fixture.acme.id, 'UTC', MONTH, {}, { limit: 2 }),
  )
  expect(first.more).toBe(true)

  const second = await asRole(fixture.acme, 'owner', (tx) =>
    sessionList(
      tx,
      fixture.acme.id,
      'UTC',
      MONTH,
      {},
      {
        limit: 2,
        before: {
          lastTurnAt: first.sessions[1]!.lastTurnAt,
          sessionId: first.sessions[1]!.sessionId,
        },
      },
    ),
  )

  const ids = [...first.sessions, ...second.sessions].map((s) => s.sessionId)
  expect(ids).toEqual(['session-4', 'session-3', 'session-2', 'session-1'])
})

test('only the period’s Sessions are listed', async () => {
  await seedTurn({ session_id: 'in', occurred_at: '2026-09-20T08:00:00Z' })
  await seedTurn({ session_id: 'out', occurred_at: '2026-08-20T08:00:00Z' })

  expect((await list('owner')).sessions.map((s) => s.sessionId)).toEqual(['in'])
})

// --- One Session -------------------------------------------------------

test('the detail groups the Agent Runs under the Session', async () => {
  await seedTurn({ occurred_at: '2026-09-20T08:00:00Z' })
  await seedTurn({
    agent_id: 'agent-1',
    occurred_at: '2026-09-20T08:05:00Z',
    spawn_depth: 1,
  })
  await seedTurn({ agent_id: 'agent-1', occurred_at: '2026-09-20T08:06:00Z' })
  await seedTurn({ agent_id: 'agent-2', occurred_at: '2026-09-20T08:07:00Z' })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    sessionDetail(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )

  expect(detail!.session.turns).toBe(4)
  expect(detail!.agentRuns).toHaveLength(2)
  expect(detail!.agentRuns[0]).toMatchObject({
    agentId: 'agent-1',
    turns: 2,
    spawnDepth: 1,
  })
  expect(detail!.agentRuns[1]).toMatchObject({ agentId: 'agent-2', turns: 1 })
  // The runs are a grouping of the Turns already counted, not a second set:
  // the Session's own count covers both.
  const inRuns = detail!.agentRuns.reduce((total, run) => total + run.turns, 0)
  expect(inRuns).toBeLessThan(detail!.session.turns)
})

test('a Session is not cut at the period the reader came from', async () => {
  // A Session that straddles midnight on the last day of a month is one
  // Session, and a detail page that cut it at the boundary would show a total
  // disagreeing with itself.
  await seedTurn({ occurred_at: '2026-08-31T23:50:00Z' })
  await seedTurn({ occurred_at: '2026-09-01T00:10:00Z' })

  const detail = await asRole(fixture.acme, 'owner', (tx) =>
    sessionDetail(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )

  expect(detail!.session.turns).toBe(2)
})

test('a Session outside the viewer’s set is no row, not a refusal', async () => {
  await seedTurn({
    member_id: fixture.acme.members.owner,
    session_id: 'theirs',
  })

  for (const [org, who] of [
    [fixture.acme, 'member'],
    [fixture.globex, 'owner'],
  ] as const) {
    expect(
      // oxlint-disable-next-line no-await-in-loop -- two reads, in order.
      await asRole(org, who, (tx) =>
        sessionDetail(
          tx,
          fixture.acme.id,
          fixture.acme.members.owner,
          'theirs',
        ),
      ),
    ).toBeNull()
  }
})

// --- The transcript, and why there is none ------------------------------

test('a stored transcript is listed, the session’s and each subagent’s', async () => {
  await seedTurn({})
  await sql`
    insert into log_artifacts
      (org_id, member_id, session_id, agent_id, storage_key, sha256, size_bytes)
    values
      (${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1', null,
       'k/main', repeat('a', 64), 100),
      (${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1',
       'agent-1', 'k/agent', repeat('b', 64), 50)
  `

  const stored = await asRole(fixture.acme, 'owner', (tx) =>
    sessionTranscripts(tx, fixture.acme.members.member, 'session-1'),
  )

  expect(stored.map((row) => row.agentId)).toEqual([null, 'agent-1'])
  expect(stored[0]!.bytes).toBe(100)

  // And a Member who may not see that person gets nothing, which is
  // `log_artifacts_read` rather than this statement.
  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      sessionTranscripts(tx, fixture.acme.members.member, 'session-1'),
    ),
  ).toEqual([])
})

test('why there is no transcript comes from the switch and the exception', async () => {
  // Ticket 86: an absent transcript is shown with its reason rather than
  // hidden, because an absent link reads as a bug. Archival is opt-in per
  // Member and off by default (ADR 0005), so this is the ordinary case.
  const api = await project('github.com/acme/api')
  const member = fixture.acme.members.member
  // A Turn on it, so `projects_read` lets the Member reach the Project at all
  // — `sessclone_visible_project_ids()` is derived from their own rows, and
  // the exclusion write joins `projects` under the Member's own claim.
  await seedTurn({ project_id: api })

  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      archivalReason(tx, member, api),
    ),
  ).toBe('off')

  // Through the Member's own write path: `members_guard_columns` refuses this
  // column to anybody else, the table owner included, which is ADR 0005's
  // "nobody in your Org can turn it on for you" enforced in the database.
  await asRole(fixture.acme, 'member', (tx) =>
    setArchivalEnabled(tx, member, true),
  )
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      archivalReason(tx, member, api),
    ),
  ).toBe('on')

  await asRole(fixture.acme, 'member', (tx) =>
    setProjectArchival(tx, member, api, false),
  )
  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      archivalReason(tx, member, api),
    ),
  ).toBe('excluded')

  // And an Owner reading the same Session still gets `on`, because
  // `member_project_archival_own` is the Member's own list in both directions
  // (ADR 0005) — an Admin "can neither read nor write another Member's
  // exclusions". The surface words `on` as a list of possibilities for exactly
  // this reason, rather than as a diagnosis it is not entitled to make.
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      archivalReason(tx, member, api),
    ),
  ).toBe('on')

  // Unreadable is null, and the surface then says the neutral thing rather
  // than guessing — an absent answer is not "archival is on".
  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      archivalReason(tx, member, api),
    ),
  ).toBeNull()
})

test('the filter lists only Projects and people the viewer may read', async () => {
  await project('github.com/acme/api')

  const mine = await asRole(fixture.acme, 'owner', (tx) =>
    sessionFilters(tx, fixture.acme.id),
  )
  expect(mine.projects.map((row) => row.key)).toEqual(['github.com/acme/api'])
  expect(mine.people.length).toBeGreaterThan(0)

  // A filter offering a name whose rows are refused would be a surface telling
  // the reader something the policies do not.
  const theirs = await asRole(fixture.globex, 'owner', (tx) =>
    sessionFilters(tx, fixture.acme.id),
  )
  expect(theirs.projects).toEqual([])
  expect(theirs.people).toEqual([])
})

test('the list reaches the Turn index rather than every Turn', async () => {
  // The ticket's own criterion: "The reads are index-backed; no query in a
  // loop." Seeded so the filter is worth an index — on a handful of rows a
  // sequential scan is the right plan and the assertion would be about the
  // fixture rather than about the query.
  await sql`
    insert into turns (
      org_id, member_id, session_id, message_id, occurred_at, model,
      input_tokens
    )
    select ${fixture.globex.id}, ${fixture.globex.members.member},
           'bulk-' || (g % 200), 'bulk_' || g,
           timestamptz '2026-09-20 08:00Z' - g * interval '1 minute',
           'claude-opus-4-6', 1000
      from generate_series(1, 5000) g
  `
  await sql`analyze turns`

  const plan = await sql<Record<string, string>[]>`
    explain (costs off)
      select turn.member_id, turn.session_id, count(*)
        from turn_costs cost
        join turns turn on turn.id = cost.turn_id
       where cost.org_id = ${fixture.acme.id}
         and turn.org_id = ${fixture.acme.id}
         and turn.occurred_at >= '2026-09-01T00:00:00Z'
         and turn.occurred_at < '2026-10-01T00:00:00Z'
       group by turn.member_id, turn.session_id
       order by max(turn.occurred_at) desc, turn.session_id desc
       limit 26
  `
  const text = plan.map((row) => Object.values(row)[0]).join('\n')

  expect(text).toMatch(/turns_org_occurred_at_idx/)
  expect(text).not.toMatch(/Seq Scan on turns/)
})

test('the end markers for a page are one statement, not one per Session', async () => {
  // "No query in a loop" is the criterion, and the loop this would naturally
  // grow is over the page's rows. Twenty Sessions, each with an end marker,
  // and the read still answers all of them.
  for (let index = 0; index < 20; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- seeded in order.
    await seedTurn({
      session_id: `s-${index}`,
      occurred_at: `2026-09-10T0${index % 10}:00:00Z`,
    })
    // oxlint-disable-next-line no-await-in-loop -- seeded in order.
    await endSession(`s-${index}`, `2026-09-10T0${index % 10}:30:00Z`)
  }

  const { sessions } = await list('owner')

  expect(sessions).toHaveLength(20)
  expect(sessions.every((session) => session.endedAt !== null)).toBe(true)
})

// --- Per model, in dollars as well as tokens (ticket 89) ---------------

const models = (who: FixtureRole) =>
  asRole(fixture.acme, who, (tx) =>
    sessionModels(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )

test('the models of a Session rank by cost and sum to its own totals', async () => {
  await seedTurn({ model: 'claude-opus-4-6', input_tokens: 2_000_000 })
  await seedTurn({ model: 'claude-opus-4-6', input_tokens: 1_000_000 })
  await seedTurn({
    model: 'claude-haiku-4-5-20251001',
    input_tokens: 1_000_000,
  })

  const [rows, detail] = await Promise.all([
    models('owner'),
    asRole(fixture.acme, 'owner', (tx) =>
      sessionDetail(
        tx,
        fixture.acme.id,
        fixture.acme.members.member,
        'session-1',
      ),
    ),
  ])

  expect(rows.map((row) => row.model)).toEqual([
    'claude-opus-4-6',
    'claude-haiku-4-5-20251001',
  ])
  expect(rows[0]).toMatchObject({ turns: 2, tokens: 3_000_000 })

  // The point of the section: it is the Session's own arithmetic cut one more
  // way, so a reader adding the rows up gets the tile above them.
  const cost = rows.reduce((total, row) => total + (row.costUsd ?? 0), 0)
  const tokens = rows.reduce((total, row) => total + row.tokens, 0)
  const turns = rows.reduce((total, row) => total + row.turns, 0)
  expect(cost).toBeCloseTo(detail!.session.costUsd!, 10)
  expect(tokens).toBe(detail!.session.tokens)
  expect(turns).toBe(detail!.session.turns)
})

test('a model with no Rate is unpriced, never zero, and still counted', async () => {
  await seedTurn({ model: 'claude-opus-4-6', input_tokens: 1_000_000 })
  await seedTurn({ model: 'a-model-nobody-priced', input_tokens: 5_000_000 })

  const rows = await models('owner')
  const unpriced = rows.find((row) => row.model === 'a-model-nobody-priced')

  // Null rather than 0: a Turn nobody has a Rate for has a cost nobody knows,
  // and $0.00 would be a claim (ADR 0002).
  expect(unpriced).toMatchObject({
    costUsd: null,
    turns: 1,
    unpricedTurns: 1,
    tokens: 5_000_000,
  })
  // And it ranks last rather than first, which is what `nulls last` buys.
  expect(rows.at(-1)!.model).toBe('a-model-nobody-priced')
})

test('Turns that reported no model are their own row', async () => {
  await seedTurn({ model: null, input_tokens: 1_000 })

  const rows = await models('owner')

  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ model: null, turns: 1 })
})

test('the models are the policies’ to scope, not the query’s', async () => {
  await seedTurn({ model: 'claude-opus-4-6' })

  // A Manager with no Scope may read no Turns, so there is nothing to group.
  expect(await models('managerWithoutScope')).toEqual([])
  // Their own Session, so the Member sees it.
  expect(await models('member')).toHaveLength(1)
})
