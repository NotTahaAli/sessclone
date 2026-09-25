import { beforeEach, expect, test, vi } from 'vitest'

import { owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 61's write at the boundary, as `org-rate-action.test.ts` does for the
// admin rates: `retention.test.ts` proves what the policies and the trigger
// do, and what it cannot prove is what the Server Action does first — and the
// action is the part anybody can POST to whether or not a form was rendered
// for them.

const signedInUser = vi.hoisted(() => vi.fn())
// No choice of Org on this request: `sessionViewer` reads the cookie.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}))
vi.mock('../lib/supabase/server', () => ({
  signedInUser,
  sessionUser: signedInUser,
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

// `lib/db`'s `asViewer` connects as `DATABASE_URL`, which in this harness is
// the role that owns the tables — and Postgres applies no policy to that role,
// so every assertion about who may write would pass against a schema with no
// policies at all. Redirected to the harness's unprivileged pool, which sets
// the same claim in the same shape production does.
vi.mock('../lib/db', async () => {
  const harness = await import('./harness')
  return { asViewer: harness.asUser, asUser: harness.asUser }
})

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
  vi.resetModules()
  signedInUser.mockReset()
})

const actAs = async (userId: string | null) => {
  if (userId) {
    signedInUser.mockResolvedValue({ id: userId, email: 'who@example.test' })
  } else {
    signedInUser.mockResolvedValue(null)
  }
  return import('../app/(dashboard)/settings/org/actions')
}

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const daysOf = async () => {
  const [row] = await sql<{ retention_days: number }[]>`
    select retention_days from orgs where id = ${fixture.acme.id}
  `
  return row!.retention_days
}

test('the bound is refused before a statement, not after one', async () => {
  const { setRetention } = await actAs(fixture.acme.users.owner)

  // The zod bound and the column's own check agree, so neither can be reached
  // past the other — and a rejected value never becomes a statement.
  for (const days of ['0', '-1', '3651', 'abc', '', '7.5']) {
    // eslint-disable-next-line no-await-in-loop -- one value at a time, so a failure names which
    const answer = await setRetention(
      null,
      form({ days, orgId: fixture.acme.id }),
    )
    expect(answer, days).toEqual({
      error: 'Retention is a number of days, from 1 to 3650.',
    })
  }
  expect(await daysOf()).toBe(90)

  // And the ends of the range are accepted.
  expect(
    await setRetention(null, form({ days: '1', orgId: fixture.acme.id })),
  ).toEqual({ saved: 1 })
  expect(
    await setRetention(null, form({ days: '3650', orgId: fixture.acme.id })),
  ).toEqual({ saved: 3650 })
})

test('a Member posting the form is refused, and changes nothing', async () => {
  const { setRetention } = await actAs(fixture.acme.users.member)

  // `orgs_write` is Owner or Admin, and a write it refuses touches no rows and
  // raises nothing — so without the check the page would look like it saved.
  expect(
    await setRetention(null, form({ days: '7', orgId: fixture.acme.id })),
  ).toEqual({ error: 'You do not have permission to change this setting.' })
  expect(await daysOf()).toBe(90)
})

test('another Org’s id in the form reaches nothing', async () => {
  const { setRetention } = await actAs(fixture.acme.users.owner)

  // The id is a hidden field, so it is the browser's word. Anything but the
  // current Org is refused before a statement (the Org switcher's rule), and
  // the policy would refuse it after.
  expect(
    await setRetention(null, form({ days: '7', orgId: fixture.globex.id })),
  ).toEqual({ error: 'Sign in again to change retention.' })

  const [globex] = await sql<{ retention_days: number }[]>`
    select retention_days from orgs where id = ${fixture.globex.id}
  `
  expect(globex!.retention_days).toBe(90)
})

test('signed out is a sentence, not a stack trace', async () => {
  const { setRetention } = await actAs(null)

  expect(
    await setRetention(null, form({ days: '7', orgId: fixture.acme.id })),
  ).toEqual({ error: 'Sign in again to change retention.' })
})

test('the Tier’s ceiling is reported as the ceiling', async () => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, retention_max_days, sort_order)
    values ('ceiling-test', 'Team', 10, 30, 1) returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${fixture.acme.id}, ${tier!.id}, 'active')
  `

  const { setRetention } = await actAs(fixture.acme.users.owner)
  const answer = await setRetention(
    null,
    form({ days: '365', orgId: fixture.acme.id }),
  )

  expect(answer).toEqual({
    error:
      'That is longer than this Org’s Tier allows. The Tier page states the ceiling.',
  })
  expect(await daysOf()).toBe(90)
})

test('a failure that is not a refusal is not reported as one', async () => {
  // A bare `catch` mapped a dead connection, a statement timeout and a future
  // constraint to "your Tier does not allow that", so an Owner would lower the
  // number, be refused again, and leave no trace anywhere.
  vi.doMock('../lib/db', () => ({
    asViewer: () => Promise.reject(new Error('the database is gone')),
  }))
  const { setRetention } = await actAs(fixture.acme.users.owner)

  await expect(
    setRetention(null, form({ days: '7', orgId: fixture.acme.id })),
  ).rejects.toThrow(/the database is gone/)
})
