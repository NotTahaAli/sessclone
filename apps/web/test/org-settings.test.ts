import { beforeEach, expect, test } from 'vitest'

import { listTimezones, setOrgTimezone } from '../lib/org'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 51: one Org, one definition of a day.
//
// The setting is only interesting because of what reads it, so the last test
// here is the one that matters: the same stored Turn, priced against a Rate
// that changed overnight, lands on a different day — and therefore at a
// different price — after the timezone moves. Nothing stored changes, which is
// the acceptance criterion written as a test rather than as a claim.

const MILLION = 1_000_000
let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const timezoneOf = async (orgId: string) => {
  const [row] = await sql<{ timezone: string }[]>`
    select timezone from orgs where id = ${orgId}
  `
  return row!.timezone
}

test('a new Org measures its days in UTC until somebody says otherwise', async () => {
  // Not a guess from whoever signed up first: that decides what every later
  // Member's chart means without anybody choosing it.
  expect(await timezoneOf(fixture.acme.id)).toBe('UTC')
})

test('an Owner or an Admin sets it; a Manager and a Member cannot', async () => {
  // `orgs_write` is Owner or Admin, which is the product IA's rule for Org
  // settings. A refused update touches no rows and raises nothing, which is
  // what `setOrgTimezone` reports.
  expect(
    await asRole(fixture.acme, 'owner', (tx) =>
      setOrgTimezone(tx, fixture.acme.id, 'Europe/London'),
    ),
  ).toBe(true)
  expect(
    await asRole(fixture.acme, 'admin', (tx) =>
      setOrgTimezone(tx, fixture.acme.id, 'Asia/Karachi'),
    ),
  ).toBe(true)

  expect(
    await asRole(fixture.acme, 'manager', (tx) =>
      setOrgTimezone(tx, fixture.acme.id, 'America/New_York'),
    ),
  ).toBe(false)
  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      setOrgTimezone(tx, fixture.acme.id, 'America/New_York'),
    ),
  ).toBe(false)

  expect(await timezoneOf(fixture.acme.id)).toBe('Asia/Karachi')
})

test("one Org's Owner cannot set another Org's timezone", async () => {
  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      setOrgTimezone(tx, fixture.acme.id, 'Europe/London'),
    ),
  ).toBe(false)

  expect(await timezoneOf(fixture.acme.id)).toBe('UTC')
})

test('a name the timezone database does not know is refused', async () => {
  await expect(
    asRole(fixture.acme, 'owner', (tx) =>
      setOrgTimezone(tx, fixture.acme.id, 'Europe/Lundon'),
    ),
  ).rejects.toThrow(/unknown timezone/)

  expect(await timezoneOf(fixture.acme.id)).toBe('UTC')
})

test('a fixed offset is refused, because it has no daylight-saving rule', async () => {
  // An Org that stored a fixed offset would have two hours of every spring
  // land in the wrong day, once a year, forever.
  //
  // Both shapes, because the first version of the guard only caught the first:
  // `-05:00` is not in the timezone database, but `EST` and `Etc/GMT+5` are —
  // they are −05:00 all year under a name, which is exactly the value this
  // column must never hold. The list the page offers and the guard on the
  // write now state one rule, so a POST cannot store what the `<select>` does
  // not offer.
  const refused = ['-05:00', 'EST', 'Etc/GMT+5', 'Factory'].map((offset) =>
    expect(
      asRole(fixture.acme, 'owner', (tx) =>
        setOrgTimezone(tx, fixture.acme.id, offset),
      ),
    ).rejects.toThrow(/timezone/),
  )
  await Promise.all(refused)
})

test('every name the list offers is one the write accepts', async () => {
  // The two halves of one rule, checked against each other rather than each
  // against a name this container happens to ship: the previous version of
  // this test asserted `US/Eastern` was filtered out, which passed only
  // because the backward-compatibility zones are not installed here.
  const zones = await asRole(fixture.acme, 'owner', (tx) => listTimezones(tx))

  expect(zones).toContain('UTC')
  expect(zones).toContain('Europe/London')
  expect(zones).toContain('Asia/Karachi')
  expect(zones.every((zone) => zone === 'UTC' || zone.includes('/'))).toBe(true)
  expect(zones.some((zone) => zone.startsWith('posix/'))).toBe(false)
  expect(zones.some((zone) => zone.startsWith('right/'))).toBe(false)
  expect(zones.some((zone) => zone.startsWith('Etc/'))).toBe(false)
  // The list is offered to a `<select>`, so it has to be finite and sorted.
  expect(zones).toEqual(zones.toSorted())
  expect(zones.length).toBeGreaterThan(300)

  // A sample rather than all 1,200: one round trip each, and the rule is a
  // string test rather than anything that varies down the list.
  const accepted = [zones[0]!, zones.at(-1)!, 'UTC'].map((zone) =>
    expect(
      asRole(fixture.acme, 'owner', (tx) =>
        setOrgTimezone(tx, fixture.acme.id, zone),
      ),
    ).resolves.toBe(true),
  )
  await Promise.all(accepted)
})

test('changing the timezone re-buckets a stored Turn rather than rewriting it', async () => {
  // The acceptance criterion. A Rate that changed overnight, and one Turn at
  // 23:00 UTC: in UTC it is the 20th and costs $1, and in Karachi (UTC+5) the
  // same instant is the 21st and costs $5.
  await sql`
    insert into rates (model, class, price_usd, effective_from)
    values ('claude-test-1', 'input', 1, date '2026-09-01'),
           ('claude-test-1', 'input', 5, date '2026-09-21')
  `
  const [turn] = await sql<{ id: string }[]>`
    insert into turns (
      org_id, member_id, session_id, message_id, occurred_at, model,
      input_tokens
    ) values (
      ${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1', 'msg_1',
      '2026-09-20T23:00:00Z', 'claude-test-1', ${MILLION}
    ) returning id
  `

  const costOf = async () => {
    const [row] = await sql<{ cost_usd: string }[]>`
      select cost_usd from turn_costs where turn_id = ${turn!.id}
    `
    return Number(row!.cost_usd)
  }
  const storedInstant = async () => {
    const [row] = await sql<{ occurred_at: Date }[]>`
      select occurred_at from turns where id = ${turn!.id}
    `
    return row!.occurred_at.toISOString()
  }

  expect(await costOf()).toBe(1)
  const before = await storedInstant()

  await asRole(fixture.acme, 'owner', (tx) =>
    setOrgTimezone(tx, fixture.acme.id, 'Asia/Karachi'),
  )

  expect(await costOf()).toBe(5)
  // And the Turn itself is untouched: the re-bucketing is entirely on the read
  // path, which is what makes the setting safe to change.
  expect(await storedInstant()).toBe(before)
})

test("another Org's timezone does not move this Org's days", async () => {
  await asRole(fixture.globex, 'owner', (tx) =>
    setOrgTimezone(tx, fixture.globex.id, 'Pacific/Kiritimati'),
  )

  expect(await timezoneOf(fixture.acme.id)).toBe('UTC')
})

test('the Org timezone reaches a Cost read by a scoped Manager, not just the owner', async () => {
  // `turn_costs` is `security_invoker` and now joins `orgs` to find the
  // timezone, so the join is subject to `orgs_read`. If a viewer could see a
  // Turn without seeing its Org row, the `coalesce` fallback would silently
  // bucket their chart in UTC and disagree with everybody else's — the exact
  // failure ticket 51 exists to prevent. It cannot happen, because every
  // branch of `sessclone_visible_member_ids()` runs through a membership in
  // that Org, and this is the narrowest of those branches saying so.
  await sql`
    insert into rates (model, class, price_usd, effective_from)
    values ('claude-test-1', 'input', 1, date '2026-09-01'),
           ('claude-test-1', 'input', 5, date '2026-09-21')
  `
  const [turn] = await sql<{ id: string }[]>`
    insert into turns (
      org_id, member_id, session_id, message_id, occurred_at, model,
      input_tokens
    ) values (
      ${fixture.acme.id}, ${fixture.acme.members.member}, 'session-1', 'msg_1',
      '2026-09-20T23:00:00Z', 'claude-test-1', ${MILLION}
    ) returning id
  `
  await asRole(fixture.acme, 'owner', (tx) =>
    setOrgTimezone(tx, fixture.acme.id, 'Asia/Karachi'),
  )

  const asManager = await asRole(
    fixture.acme,
    'manager',
    (tx) =>
      tx<
        { cost_usd: string }[]
      >`select cost_usd from turn_costs where turn_id = ${turn!.id}`,
  )

  expect(Number(asManager[0]!.cost_usd)).toBe(5)
})
