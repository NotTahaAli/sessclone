import { beforeEach, expect, test } from 'vitest'

import {
  asRole,
  owner as sql,
  seedFixture,
  type Fixture,
  type FixtureRole,
} from './harness'
import {
  labelSession,
  ownDisplayName,
  projectNickname,
  renameProject,
  setDisplayName,
} from '../lib/names'
import { breakdown } from '../lib/breakdown'
import { sessionDetail } from '../lib/sessions'

// Tickets 90 and 91: the three names, and who may write each.
//
// Every assertion here runs as `sessclone_app`. The owning role owns the
// tables and Postgres applies no policy to it, so a refusal proven on that
// connection proves nothing (`supabase/README.md`); these three writes are
// governed by `projects_rename`, `session_labels_write` and
// `users_write_self`, and this is the only connection that feels them.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const project = async (key = 'github.com/acme/api') => {
  const [row] = await sql<{ id: string }[]>`
    insert into projects (org_id, key) values (${fixture.acme.id}, ${key})
    returning id
  `
  return row!.id
}

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

const rename = (who: FixtureRole, projectId: string, name: string | null) =>
  asRole(fixture.acme, who, (tx) => renameProject(tx, projectId, name))

// --- A Project's name --------------------------------------------------

test('an Owner and an Admin may name a Project', async () => {
  const id = await project()

  expect(await rename('owner', id, 'The API')).toBe(true)
  expect(
    await asRole(fixture.acme, 'admin', (tx) => projectNickname(tx, id)),
  ).toBe('The API')
  expect(await rename('admin', id, 'The API, renamed')).toBe(true)
})

test('a Manager and a Member may not, and the refusal writes nothing', async () => {
  const id = await project()
  await rename('owner', id, 'The API')

  // A policy refusal on an update matches no row: it writes nothing and
  // raises nothing, which is why the action reports a refusal from the
  // returned count rather than from an exception it never gets.
  expect(await rename('manager', id, 'Mine now')).toBe(false)
  expect(await rename('member', id, 'Mine now')).toBe(false)

  const [row] = await sql<{ nickname: string }[]>`
    select nickname from projects where id = ${id}
  `
  expect(row!.nickname).toBe('The API')
})

test('an Admin of another Org may not name this one’s Project', async () => {
  const id = await project()

  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      renameProject(tx, id, 'Not yours'),
    ),
  ).toBe(false)
})

test('naming a Project moves nothing else on the row', async () => {
  const id = await project()

  // `projects_rename` grants the row, and a row is every column on it. The
  // guard is what keeps a rename from re-pointing a Project at another key —
  // which would move every Turn filed under it.
  await expect(
    asRole(
      fixture.acme,
      'owner',
      (tx) =>
        tx`update projects set key = 'github.com/acme/other' where id = ${id}`,
    ),
  ).rejects.toThrow(/only the nickname/)

  await expect(
    asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update projects set last_seen_at = now() where id = ${id}`,
    ),
  ).rejects.toThrow(/only the nickname/)
})

test('the name is what the breakdown labels the Project, and the key stays', async () => {
  const id = await project()
  await seedTurn({ project_id: id })
  await rename('owner', id, 'The API')

  const cut = await asRole(fixture.acme, 'owner', (tx) =>
    breakdown(
      tx,
      fixture.acme.id,
      'UTC',
      { from: '2026-09-01', to: '2026-10-01' },
      'projects',
    ),
  )

  expect(cut.rows[0]!.label).toBe('The API')
  // The key is not hidden by the name: it is the identity, and it is what a
  // reader checks when two Projects are called the same thing.
  expect(cut.rows[0]!.note).toContain('github.com/acme/api')
})

// --- A Session's name --------------------------------------------------

const label = (who: FixtureRole, name: string | null, member?: string) =>
  asRole(fixture.acme, who, (tx) =>
    labelSession(
      tx,
      fixture.acme.id,
      member ?? fixture.acme.members.member,
      'session-1',
      name,
    ),
  )

test('the Session’s own Member names it, and an Owner or Admin may too', async () => {
  await seedTurn()

  expect(await label('member', 'Thursday’s migration')).toBe(true)
  expect(await label('owner', 'Thursday’s migration, renamed')).toBe(true)
  expect(await label('admin', 'Thursday’s migration, again')).toBe(true)

  const detail = await asRole(fixture.acme, 'member', (tx) =>
    sessionDetail(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )
  expect(detail!.session.label).toBe('Thursday’s migration, again')
})

test('somebody else’s Session is not yours to name', async () => {
  await seedTurn()

  // A Manager may *read* this Session — the fixture's Scope covers the
  // Member — and still may not write its name: reading is what a Scope
  // grants, and this writes something the whole Org then reads.
  await expect(label('manager', 'Mine now')).rejects.toThrow()

  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from session_labels
  `
  expect(row!.n).toBe(0)
})

test('another Org’s Owner cannot label a Session in this one', async () => {
  await seedTurn()

  await expect(
    asRole(fixture.globex, 'owner', (tx) =>
      labelSession(
        tx,
        fixture.acme.id,
        fixture.acme.members.member,
        'session-1',
        'Not yours',
      ),
    ),
  ).rejects.toThrow()
})

test('emptying the box removes the name rather than storing a blank', async () => {
  await seedTurn()
  await label('member', 'Thursday’s migration')

  expect(await label('member', null)).toBe(true)

  const detail = await asRole(fixture.acme, 'member', (tx) =>
    sessionDetail(
      tx,
      fixture.acme.id,
      fixture.acme.members.member,
      'session-1',
    ),
  )
  expect(detail!.session.label).toBeNull()

  // And a blank is refused by the schema besides, so no path stores one.
  await expect(label('member', '   ')).rejects.toThrow()
})

test('a Session’s name is read by whoever may read the Session', async () => {
  await seedTurn()
  await label('member', 'Thursday’s migration')

  const seen = await asRole(
    fixture.acme,
    'managerWithoutScope',
    (tx) => tx<{ label: string }[]>`select label from session_labels`,
  )
  // A Manager with no Scope reads no Turns, so they read no names either:
  // the label follows the Session rather than carrying its own visibility.
  expect(seen).toEqual([])
})

// --- A person's name ---------------------------------------------------

test('a person sets their own name, and nobody sets it for them', async () => {
  const me = fixture.acme.users.member

  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      setDisplayName(tx, me, 'Taha'),
    ),
  ).toBe(true)
  expect(
    await asRole(fixture.acme, 'member', (tx) => ownDisplayName(tx, me)),
  ).toBe('Taha')

  // An Owner administers the Org. A name is not the Org's.
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setDisplayName(tx, me, 'Not their choice'),
    ),
  ).toBe(false)
  expect(
    await asRole(fixture.acme, 'member', (tx) => ownDisplayName(tx, me)),
  ).toBe('Taha')
})

test('a name leads and the address stays, in the breakdown by person', async () => {
  await seedTurn()
  await asRole(fixture.acme, 'member', (tx) =>
    setDisplayName(tx, fixture.acme.users.member, 'Taha'),
  )

  const cut = await asRole(fixture.acme, 'owner', (tx) =>
    breakdown(
      tx,
      fixture.acme.id,
      'UTC',
      { from: '2026-09-01', to: '2026-10-01' },
      'members',
    ),
  )

  expect(cut.rows[0]!.label).toBe('Taha')
  expect(cut.rows[0]!.note).toContain('@')
})

test('a blank name is refused rather than stored', async () => {
  await expect(
    asRole(fixture.acme, 'member', (tx) =>
      setDisplayName(tx, fixture.acme.users.member, '   '),
    ),
  ).rejects.toThrow()
})
