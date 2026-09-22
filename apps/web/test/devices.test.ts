import { beforeEach, expect, test } from 'vitest'

import { DEVICE_LIMIT, listOwnDevices, renameDevice } from '../lib/devices'
import { asRole, owner as sql, seedFixture, type Fixture } from './harness'

// Ticket 57. The list is one policy-scoped read, so what is worth proving is
// the boundary: a Member sees their own machines and nobody else's, and a
// rename of somebody else's writes nothing rather than quietly succeeding.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const device = async (
  memberId: string,
  key: string,
  over: Record<string, unknown> = {},
) => {
  const [row] = await sql<{ id: string }[]>`
    insert into devices ${sql({ member_id: memberId, key, ...over })}
    returning id
  `
  return row!.id
}

test('own machines only, most recently seen first', async () => {
  await device(fixture.acme.members.member, 'host:thinkpad', {
    last_seen_at: '2026-09-01T10:00:00Z',
  })
  await device(fixture.acme.members.member, 'cloud:acct-1', {
    last_seen_at: '2026-09-20T10:00:00Z',
  })
  // The Owner's machine. Readable through `devices_read`, which is wider than
  // this page: an Owner sees the Org's. The list is still the viewer's own.
  await device(fixture.acme.members.owner, 'host:macbook')

  const rows = await asRole(fixture.acme, 'member', (tx) =>
    listOwnDevices(tx),
  ).then((result) => result.devices)

  expect(rows.map((row) => row.key)).toEqual(['cloud:acct-1', 'host:thinkpad'])
})

test('an Owner sees their own machines, not the Org’s', async () => {
  await device(fixture.acme.members.member, 'host:thinkpad')

  const rows = await asRole(fixture.acme, 'owner', (tx) =>
    listOwnDevices(tx),
  ).then((result) => result.devices)

  expect(rows).toEqual([])
})

test('the Turn count is per machine', async () => {
  const id = await device(fixture.acme.members.member, 'host:thinkpad')
  const other = await device(fixture.acme.members.member, 'cloud:acct-1')
  for (const [index, deviceId] of [id, id, other].entries()) {
    // oxlint-disable-next-line no-await-in-loop -- three rows, ordered seeds.
    await sql`
      insert into turns ${sql({
        org_id: fixture.acme.id,
        member_id: fixture.acme.members.member,
        device_id: deviceId,
        session_id: 'session-1',
        message_id: `msg_${index}`,
        occurred_at: '2026-09-20T08:00:00Z',
        model: 'claude-opus-4-6',
      })}
    `
  }

  const rows = await asRole(fixture.acme, 'member', (tx) =>
    listOwnDevices(tx),
  ).then((result) => result.devices)

  expect(Object.fromEntries(rows.map((row) => [row.key, row.turns]))).toEqual({
    'host:thinkpad': 2,
    'cloud:acct-1': 1,
  })
})

test('a rename sticks, and an empty name clears it', async () => {
  const id = await device(fixture.acme.members.member, 'host:thinkpad')

  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      renameDevice(tx, id, 'work laptop'),
    ),
  ).toBe(true)
  expect(
    (
      await asRole(fixture.acme, 'member', (tx) => listOwnDevices(tx)).then(
        (result) => result.devices,
      )
    )[0]!.nickname,
  ).toBe('work laptop')

  expect(
    await asRole(fixture.acme, 'member', (tx) => renameDevice(tx, id, null)),
  ).toBe(true)
  expect(
    (
      await asRole(fixture.acme, 'member', (tx) => listOwnDevices(tx)).then(
        (result) => result.devices,
      )
    )[0]!.nickname,
  ).toBeNull()
})

test('nobody renames another Member’s machine, not even the Owner', async () => {
  const id = await device(fixture.acme.members.member, 'host:thinkpad')

  // `devices_rename` is own-only, so this matches no row: no raise, no write.
  expect(
    await asRole(fixture.acme, 'owner', (tx) => renameDevice(tx, id, 'mine')),
  ).toBe(false)
  expect(
    await asRole(fixture.acme, 'manager', (tx) =>
      renameDevice(tx, id, 'mine now'),
    ),
  ).toBe(false)

  const [row] = await sql<{ nickname: string | null }[]>`
    select nickname from devices where id = ${id}
  `
  expect(row!.nickname).toBeNull()
})

test('another Org’s machine is neither listed nor renamed', async () => {
  const id = await device(fixture.globex.members.member, 'host:thinkpad')

  expect(
    await asRole(fixture.acme, 'member', (tx) => listOwnDevices(tx)).then(
      (result) => result.devices,
    ),
  ).toEqual([])
  expect(
    await asRole(fixture.acme, 'member', (tx) => renameDevice(tx, id, 'mine')),
  ).toBe(false)
})

test('the list is capped, and says so', async () => {
  await Promise.all(
    Array.from({ length: DEVICE_LIMIT + 1 }, (_, index) =>
      device(fixture.acme.members.member, `host:box-${index}`),
    ),
  )

  const { devices, more } = await asRole(fixture.acme, 'member', (tx) =>
    listOwnDevices(tx),
  )

  expect(devices).toHaveLength(DEVICE_LIMIT)
  expect(more).toBe(true)
})

test('the Turn count is the last 30 days, not all of history', async () => {
  const id = await device(fixture.acme.members.member, 'host:thinkpad')
  await sql`
    insert into turns ${sql({
      org_id: fixture.acme.id,
      member_id: fixture.acme.members.member,
      device_id: id,
      session_id: 'old',
      message_id: 'msg_old',
      occurred_at: '2020-01-01T00:00:00Z',
      model: 'claude-opus-4-6',
    })}
  `

  const { devices } = await asRole(fixture.acme, 'member', (tx) =>
    listOwnDevices(tx),
  )

  expect(devices[0]!.turns).toBe(0)
})
