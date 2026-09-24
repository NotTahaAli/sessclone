import { beforeEach, expect, test, vi } from 'vitest'

import { owner as sql, seedFixture, type Fixture } from './harness'

// Marking a failed Session viewed, at the boundary: `failures.test.ts` proves
// the policy and the count; this is what the Server Action does with a POST,
// which anybody can send whether or not a form was rendered for them.

const signedInUser = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/server', () => ({
  signedInUser,
  sessionUser: signedInUser,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
// As `retention-action.test.ts` says: the owning role ignores every policy,
// so the action's reads and writes go through the unprivileged pool.
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser, asUser: harness.asUser }
})

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  vi.resetModules()
  signedInUser.mockReset()
  await sql`
    insert into session_events
      (org_id, member_id, session_id, kind, occurred_at, detail)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, 'failed-1',
            'stop_failure', now() - interval '1 minute',
            ${sql.json({ error_type: 'rate_limit' })})
  `
})

const actAs = async (userId: string) => {
  signedInUser.mockResolvedValue({ id: userId, email: 'who@example.test' })
  return import('../app/(dashboard)/costs/failure-actions')
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const marks = () =>
  sql<{ viewer: string; session_id: string }[]>`
    select viewer_member_id::text as viewer, session_id from failure_views
  `

test('marks the one Session as the signed-in viewer, and refuses half a Session', async () => {
  const { markFailuresViewedAction } = await actAs(fixture.acme.users.owner)

  // A Session id without whose Session it is names nothing: refused unwritten.
  await markFailuresViewedAction(form({ sessionId: 'failed-1' }))
  expect(await marks()).toEqual([])

  // A mark says when its page was read; one without, or with a time that is
  // no date, is refused unwritten.
  const session = {
    memberId: fixture.acme.members.member,
    sessionId: 'failed-1',
  }
  await markFailuresViewedAction(form(session))
  await markFailuresViewedAction(
    form({ ...session, seenAt: '2026-13-45T00:00:00Z' }),
  )
  expect(await marks()).toEqual([])

  await markFailuresViewedAction(
    form({ ...session, seenAt: new Date(Date.now() + 60_000).toISOString() }),
  )
  expect(await marks()).toEqual([
    { viewer: fixture.acme.members.owner, session_id: 'failed-1' },
  ])
})
