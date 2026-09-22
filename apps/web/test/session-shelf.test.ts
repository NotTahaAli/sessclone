import { beforeEach, expect, test } from 'vitest'

import {
  asRole,
  owner as sql,
  seedFixture,
  type Fixture,
  type FixtureRole,
} from './harness'
import { labelSession, setSessionState } from '../lib/names'
import { breakdown } from '../lib/breakdown'
import { sessionDetail, sessionList, sessionModels } from '../lib/sessions'

// Tickets 92, 93 and 94: which shelf a Session is on, the two filters that
// find one, and the token classes behind its models.
//
// Every write here runs as `sessclone_app`. The owning role owns the tables
// and Postgres applies no policy to it, so a refusal proven on that
// connection proves nothing (`supabase/README.md`) — `session_labels_write`
// is what governs these, and this is the only connection that feels it.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const RANGE = { from: '2026-09-01', to: '2026-10-01' }
const UTC = 'UTC'

let nextMessage = 0

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
      input_tokens: 1000,
      ...over,
    })}
  `
}

let nextFailure = 0

/** A `stop_failure`, which is what ticket 93's filter reads. */
const seedFailure = async (sessionId: string) => {
  nextFailure += 1
  await sql`
    insert into session_events ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      session_id: sessionId,
      kind: 'stop_failure',
      // Distinct times: `session_events_identity_key` dedups an identical
      // observation, which is the point of it.
      occurred_at: `2026-09-20T09:0${nextFailure}:00Z`,
      detail: JSON.stringify({ error_type: 'overloaded_error' }),
    })}
  `
}

const shelve = (
  who: FixtureRole,
  state: 'archived' | 'hidden' | null,
  sessionId = 'session-1',
) =>
  asRole(fixture.acme, who, (tx) =>
    setSessionState(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      sessionId,
      state,
    ),
  )

const list = (
  who: FixtureRole,
  filter: Parameters<typeof sessionList>[4] = {},
) =>
  asRole(fixture.acme, who, (tx) =>
    sessionList(tx, fixture.acme.id, UTC, RANGE, filter),
  )

const ids = (page: { sessions: { sessionId: string }[] }) =>
  page.sessions.map((s) => s.sessionId).toSorted()

// --- Who may move a Session ---------------------------------------------

test('the Session’s own Member archives it, and an Owner or Admin may too', async () => {
  await seedTurn()

  expect(await shelve('member', 'archived')).toBe(true)
  expect(await shelve('owner', 'hidden')).toBe(true)
  expect(await shelve('admin', 'archived')).toBe(true)

  const detail = await asRole(fixture.acme, 'member', (tx) =>
    sessionDetail(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )
  expect(detail!.session.state).toBe('archived')
})

test('somebody else’s Session is not yours to archive', async () => {
  await seedTurn()

  // A Manager may read this Session — the fixture's Scope covers the Member —
  // and still may not shelve it, for the reason naming states: a Scope grants
  // reading, and this writes something the whole Org then sees.
  await expect(shelve('manager', 'archived')).rejects.toThrow()

  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from session_labels
  `
  expect(row!.n).toBe(0)
})

test('another Org’s Owner cannot shelve a Session in this one', async () => {
  await seedTurn()

  await expect(
    asRole(fixture.globex, 'owner', (tx) =>
      setSessionState(
        tx,
        fixture.acme.id,
        fixture.acme.members.member,
        'session-1',
        'hidden',
      ),
    ),
  ).rejects.toThrow()
})

// --- The name and the state share a row without treading on each other ---

test('archiving a named Session keeps its name, and clearing the name keeps the shelf', async () => {
  await seedTurn()

  await asRole(fixture.acme, 'member', (tx) =>
    labelSession(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
      'Thursday’s migration',
    ),
  )
  await shelve('member', 'archived')

  await asRole(fixture.acme, 'member', (tx) =>
    labelSession(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
      null,
    ),
  )

  const [row] = await sql<{ label: string | null; state: string | null }[]>`
    select label, state from session_labels
  `
  expect(row).toEqual({ label: null, state: 'archived' })
})

test('putting a Session back with no name on it takes the row with it', async () => {
  await seedTurn()
  await shelve('member', 'archived')
  await shelve('member', null)

  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from session_labels
  `
  // A row holding neither a name nor a state says nothing, and
  // `session_labels_not_empty` is what makes that a rule rather than a habit.
  expect(row!.n).toBe(0)
})

// --- What the list shows -------------------------------------------------

test('the list shows neither an archived nor a hidden Session by default', async () => {
  await seedTurn({ session_id: 'session-1' })
  await seedTurn({ session_id: 'session-2' })
  await seedTurn({ session_id: 'session-3' })

  await shelve('member', 'archived', 'session-2')
  await shelve('member', 'hidden', 'session-3')

  expect(ids(await list('member'))).toEqual(['session-1'])
})

test('a named Session with no state is still listed', async () => {
  await seedTurn()
  await asRole(fixture.acme, 'member', (tx) =>
    labelSession(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
      'Thursday’s migration',
    ),
  )

  // The row exists and its `state` is null, which `is distinct from` handles
  // and `<> 'archived'` would not: that comparison is null, and so not true.
  expect(ids(await list('member'))).toEqual(['session-1'])
})

test('the archived shelf shows the archived ones and nothing else', async () => {
  await seedTurn({ session_id: 'session-1' })
  await seedTurn({ session_id: 'session-2' })
  await seedTurn({ session_id: 'session-3' })

  await shelve('member', 'archived', 'session-2')
  await shelve('member', 'hidden', 'session-3')

  expect(ids(await list('member', { state: 'archived' }))).toEqual([
    'session-2',
  ])
})

test('a hidden Session’s own page still loads', async () => {
  await seedTurn()
  await shelve('member', 'hidden')

  const detail = await asRole(fixture.acme, 'member', (tx) =>
    sessionDetail(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )
  expect(detail!.session.state).toBe('hidden')
})

// --- Neither state is a number -------------------------------------------

test('archiving and hiding change no figure', async () => {
  await seedTurn({ session_id: 'session-1' })
  await seedTurn({ session_id: 'session-2' })

  const spend = () =>
    asRole(fixture.acme, 'owner', (tx) =>
      breakdown(tx, fixture.acme.id, UTC, RANGE, 'members'),
    )

  const before = await spend()

  await shelve('member', 'archived', 'session-1')
  await shelve('member', 'hidden', 'session-2')

  // The whole point of ticket 92: what the Org spent is what the Org spent,
  // and a state that moved it would make the figure wrong in a way nothing on
  // the page could explain.
  expect(await spend()).toEqual(before)
})

// --- Ticket 93's two filters ---------------------------------------------

test('search matches the name and the session id, anywhere and either case', async () => {
  await seedTurn({ session_id: 'session-1' })
  await seedTurn({ session_id: 'deadbeef-cafe' })

  await asRole(fixture.acme, 'member', (tx) =>
    labelSession(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
      'Thursday’s migration',
    ),
  )

  expect(ids(await list('member', { search: 'MIGRATION' }))).toEqual([
    'session-1',
  ])
  // A uuid nobody types in full: the match is a substring, not a prefix.
  expect(ids(await list('member', { search: 'beef' }))).toEqual([
    'deadbeef-cafe',
  ])
  expect(ids(await list('member', { search: 'nothing here' }))).toEqual([])
})

test('failed only reads a stop_failure, not a missing end marker', async () => {
  await seedTurn({ session_id: 'session-1' })
  await seedTurn({ session_id: 'session-2' })
  await seedFailure('session-2')

  expect(ids(await list('member', { failedOnly: true }))).toEqual(['session-2'])
})

test('a Session with two failures is still one row', async () => {
  await seedTurn({ session_id: 'session-1' })
  await seedFailure('session-1')
  await seedFailure('session-1')

  const page = await list('member', { failedOnly: true })
  expect(page.sessions).toHaveLength(1)
  // An `exists` rather than a join, so the aggregates are not doubled by the
  // number of failures behind the row.
  expect(page.sessions[0]!.turns).toBe(1)
})

test('the filters compose rather than resetting each other', async () => {
  await seedTurn({ session_id: 'session-1' })
  await seedTurn({ session_id: 'session-2' })
  await seedFailure('session-1')
  await seedFailure('session-2')
  await shelve('member', 'archived', 'session-1')

  expect(
    ids(await list('member', { state: 'archived', failedOnly: true })),
  ).toEqual(['session-1'])
})

// --- Ticket 94's columns -------------------------------------------------

test('the four token classes are reported apart and sum to the total', async () => {
  await seedTurn({
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_input_tokens: 30_000,
    cache_creation_input_tokens: 4000,
    cache_creation_5m_input_tokens: 3000,
    cache_creation_1h_input_tokens: 1000,
  })

  const [model] = await asRole(fixture.acme, 'member', (tx) =>
    sessionModels(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )

  expect(model!.inputTokens).toBe(1000)
  expect(model!.outputTokens).toBe(200)
  expect(model!.cacheReadTokens).toBe(30_000)
  // The reported cache-creation total, not the 5m and 1h columns: those are
  // subsets of it, and adding them would count 4000 tokens twice.
  expect(model!.cacheWriteTokens).toBe(4000)
  expect(model!.tokens).toBe(35_200)
})
