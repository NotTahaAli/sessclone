import { beforeEach, expect, test } from 'vitest'

import { listArchivalProjects } from '../lib/archival'
import { onboardingFacts } from '../lib/onboarding'
import { archiveList } from '../lib/transcript-archive'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 139: a Tier's history window hides older Turns from every dashboard
// read, through the read policy, and deletes nothing.

let fixture: Fixture
let nth = 0

beforeEach(async () => {
  fixture = await seedFixture()
  nth = 0
})

const onTier = async (
  orgId: string,
  historyDays: number | null,
  status = 'active',
) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, seat_price_usd, history_days, sort_order)
    values (${`h-${orgId}-${historyDays}-${status}`}, 'T', 10, ${historyDays}, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${orgId}, ${tier!.id}, ${status})
    on conflict (org_id) do update
      set tier_id = excluded.tier_id, status = excluded.status
  `
}

const turn = async (daysAgo: number, session = 's1') => {
  nth += 1
  await sql`
    insert into turns (org_id, member_id, session_id, message_id, occurred_at)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, ${session},
            ${`m${nth}`}, now() - ${`${daysAgo} days`}::interval)
  `
}

const visible = (role: 'owner' | 'member') =>
  asRole(fixture.acme, role, async (tx) => {
    const [row] = await tx<{ n: number }[]>`
      select count(*)::int as n from turn_costs cost
        join turns turn on turn.id = cost.turn_id
       where turn.org_id = ${fixture.acme.id}
    `
    return row!.n
  })

test('Turns older than the window are hidden from every Role, and kept', async () => {
  await onTier(fixture.acme.id, 90)
  await turn(10)
  await turn(89)
  await turn(92, 's2')
  await turn(400, 's3')

  expect(await visible('owner')).toBe(2)
  expect(await visible('member')).toBe(2)
  const [kept] = await sql`select count(*)::int as n from turns`
  expect(kept!.n).toBe(4)
})

test('no window, or no live subscription, shows everything', async () => {
  await turn(400)
  expect(await visible('owner')).toBe(1)
  await onTier(fixture.acme.id, null)
  expect(await visible('owner')).toBe(1)
  await onTier(fixture.acme.id, 90, 'inactive')
  expect(await visible('owner')).toBe(1)
})

test('an upgrade brings older Turns back', async () => {
  await onTier(fixture.acme.id, 90)
  await turn(200)
  expect(await visible('owner')).toBe(0)
  await onTier(fixture.acme.id, 365)
  expect(await visible('owner')).toBe(1)
})

test('a straddling Session reports its hidden Turns', async () => {
  await onTier(fixture.acme.id, 90)
  await turn(10, 'edge')
  await turn(120, 'edge')
  await turn(10, 'inside')
  const hidden = (session: string) =>
    asRole(fixture.acme, 'owner', async (tx) => {
      const [row] = await tx<{ hidden: boolean }[]>`
        select sessclone_session_has_hidden_turns(
          ${fixture.acme.members.member}, ${session}) as hidden
      `
      return row!.hidden
    })
  expect(await hidden('edge')).toBe(true)
  expect(await hidden('inside')).toBe(false)
  // Somebody who cannot see the Member learns nothing.
  const outsider = await asRole(fixture.globex, 'owner', async (tx) => {
    const [row] = await tx<{ hidden: boolean }[]>`
      select sessclone_session_has_hidden_turns(
        ${fixture.acme.members.member}, 'edge') as hidden
    `
    return row!.hidden
  })
  expect(outsider).toBe(false)
})

test('failure events follow the same window', async () => {
  await onTier(fixture.acme.id, 90)
  await sql`
    insert into session_events (org_id, member_id, session_id, kind, occurred_at)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, 'old', 'session_end',
            now() - interval '200 days'),
           (${fixture.acme.id}, ${fixture.acme.members.member}, 'new', 'session_end',
            now() - interval '2 days')
  `
  const rows = await asRole(
    fixture.acme,
    'owner',
    (tx) => tx`select session_id from session_events`,
  )
  expect(rows.map((row) => row.session_id)).toEqual(['new'])
})

test('facts about old Turns read past the window: onboarding, archival Projects, a transcript', async () => {
  await onTier(fixture.acme.id, 90)
  const [project] = await sql<{ id: string }[]>`
    insert into projects (org_id, key)
    values (${fixture.acme.id}, 'github.com/acme/old') returning id
  `
  const [device] = await sql<{ id: string }[]>`
    insert into devices (member_id, key)
    values (${fixture.acme.members.member}, 'host:old') returning id
  `
  await sql`
    insert into turns (org_id, member_id, project_id, device_id, session_id,
                       message_id, occurred_at)
    values (${fixture.acme.id}, ${fixture.acme.members.member}, ${project!.id},
            ${device!.id}, 'old', 'm-a', '2025-06-01T10:00:00Z'),
           (${fixture.acme.id}, ${fixture.acme.members.member}, ${project!.id},
            ${device!.id}, 'old', 'm-b', '2025-06-03T10:00:00Z')
  `
  await sql`
    insert into log_artifacts ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      project_id: null, // so only the Turns name the Project
      session_id: 'old',
      storage_key: 'orgs/acme/old.jsonl',
      sha256: 'a'.repeat(64),
      size_bytes: 1,
    })}
  `
  const zipped = (
    filter: Partial<Parameters<typeof archiveList>[1]['filter']>,
  ) =>
    asRole(fixture.acme, 'owner', async (tx) =>
      (
        await archiveList(tx, {
          orgId: fixture.acme.id,
          timezone: 'UTC',
          filter: { members: [], projects: [], devices: [], ...filter },
        })
      ).map((item) => [item.sessionId, item.endedAt.toISOString()]),
    )

  // Onboarding: an Org whose Turns are all old has still collected.
  expect(
    (
      await asRole(fixture.acme, 'owner', (tx) =>
        onboardingFacts(tx, fixture.acme.id),
      )
    ).any_turns,
  ).toBe(true)
  // The archival list still names the Project to opt out of.
  expect(
    (
      await asRole(fixture.acme, 'member', (tx) => listArchivalProjects(tx))
    ).map((row) => row.project_id),
  ).toEqual([project!.id])
  // The zip's Device filter and dates read the transcript's own Turns, and
  // its time in the zip is its last Turn, not its upload.
  expect(await zipped({ devices: [device!.id] })).toEqual([
    ['old', '2025-06-03T10:00:00.000Z'],
  ])
  // Any overlap brings the transcript whole; a range past it does not.
  expect(await zipped({ from: '2025-06-02', to: '2025-06-02' })).toHaveLength(1)
  expect(await zipped({ from: '2025-05-01', to: '2025-06-01' })).toHaveLength(1)
  expect(await zipped({ to: '2025-05-31' })).toHaveLength(0)
  expect(await zipped({ from: '2025-06-04' })).toHaveLength(0)
  // Somebody who cannot see the Member learns nothing from the span.
  const outsider = await asRole(fixture.globex, 'owner', async (tx) => {
    const [row] = await tx<{ started_at: Date | null; device_ids: string[] }[]>`
      select * from sessclone_transcript_span(
        ${fixture.acme.members.member}, 'old', null)
    `
    return row
  })
  expect(outsider).toEqual({ started_at: null, ended_at: null, device_ids: [] })
})
