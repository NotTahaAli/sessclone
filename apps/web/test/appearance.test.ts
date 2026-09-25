// oxlint-disable no-await-in-loop -- one database and one connection: the
// awaits in the loops below are a sequence on purpose, since each statement
// asserts what the one before it left behind.
import { beforeEach, expect, test } from 'vitest'

import { CLAY, CLAY_SEED, resolveAccent } from '../lib/accent'
import {
  decodeAppearance,
  encodeAppearance,
  setMemberAccent,
  setMemberTheme,
  setOrgAccent,
  setOrgAccentLock,
  viewerAppearance,
} from '../lib/appearance'
import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'

// Ticket 77, and specifically its fifth criterion: "No Role can write another
// Member's appearance settings, proven as SQL against the policies rather than
// through the UI." That is what the middle of this file is — every write below
// goes through `sessclone_app` with a viewer's claim set, which is the only
// connection on which a refusal is evidence of anything.

let fixture: Fixture

beforeEach(async () => {
  fixture = await seedFixture()
})

const rowOf = async (memberId: string) => {
  const [row] = await sql<
    { accent_seed: string | null; theme: string }[]
  >`select accent_seed, theme from members where id = ${memberId}`
  return row!
}

const BLUE = '#6A9BCC'

test('a new Org and a new Member start on Clay, following the device', async () => {
  // The default matters: it is what every deployment looks like before anybody
  // opens the setting, and `globals.css` declares the same values for a
  // signed-out visitor.
  const appearance = await asRole(fixture.acme, 'member', (tx) =>
    viewerAppearance(tx, fixture.acme.members.member),
  )
  expect(appearance).toMatchObject({
    seed: CLAY_SEED,
    tones: CLAY,
    theme: 'system',
    orgSeed: CLAY_SEED,
    locked: false,
    ownSeed: null,
  })
})

test('a Member’s own seed wins over the Org’s, and clearing it goes back', async () => {
  await asRole(fixture.acme, 'owner', (tx) =>
    setOrgAccent(tx, fixture.acme.id, {
      seed: BLUE,
      tones: resolveAccent(BLUE),
    }),
  )

  const fig = '#C46686'
  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      setMemberAccent(tx, fixture.acme.members.member, {
        seed: fig,
        tones: resolveAccent(fig),
      }),
    ),
  ).toBe(true)

  const mine = await asRole(fixture.acme, 'member', (tx) =>
    viewerAppearance(tx, fixture.acme.members.member),
  )
  expect(mine.seed).toBe(fig)
  expect(mine.tones).toEqual(resolveAccent(fig))
  expect(mine.orgSeed).toBe(BLUE)

  // Somebody else in the same Org is on the Org's, which is the point of the
  // Org's default existing at all.
  expect(
    (
      await asRole(fixture.acme, 'admin', (tx) =>
        viewerAppearance(tx, fixture.acme.members.admin),
      )
    ).seed,
  ).toBe(BLUE)

  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      setMemberAccent(tx, fixture.acme.members.member, null),
    ),
  ).toBe(true)
  const back = await asRole(fixture.acme, 'member', (tx) =>
    viewerAppearance(tx, fixture.acme.members.member),
  )
  expect(back.seed).toBe(BLUE)
  expect(back.ownSeed).toBeNull()
})

test('an Org’s lock overrides a stored Member seed without destroying it', async () => {
  const fig = '#C46686'
  await asRole(fixture.acme, 'member', (tx) =>
    setMemberAccent(tx, fixture.acme.members.member, {
      seed: fig,
      tones: resolveAccent(fig),
    }),
  )
  await asRole(fixture.acme, 'owner', (tx) =>
    setOrgAccentLock(tx, fixture.acme.id, true),
  )

  const locked = await asRole(fixture.acme, 'member', (tx) =>
    viewerAppearance(tx, fixture.acme.members.member),
  )
  expect(locked.seed).toBe(CLAY_SEED)
  expect(locked.locked).toBe(true)
  // Kept, which is what makes unlocking give everybody their choice back
  // rather than making the whole Org pick again.
  expect(locked.ownSeed).toBe(fig)
  expect((await rowOf(fixture.acme.members.member)).accent_seed).toBe(fig)

  await asRole(fixture.acme, 'owner', (tx) =>
    setOrgAccentLock(tx, fixture.acme.id, false),
  )
  expect(
    (
      await asRole(fixture.acme, 'member', (tx) =>
        viewerAppearance(tx, fixture.acme.members.member),
      )
    ).seed,
  ).toBe(fig)
})

test('a locked Org refuses a Member’s seed, and never their theme', async () => {
  await asRole(fixture.acme, 'owner', (tx) =>
    setOrgAccentLock(tx, fixture.acme.id, true),
  )

  await expect(
    asRole(fixture.acme, 'member', (tx) =>
      setMemberAccent(tx, fixture.acme.members.member, {
        seed: BLUE,
        tones: resolveAccent(BLUE),
      }),
    ),
  ).rejects.toThrow(/locked its accent/)

  // The mode is always personal (`design-system.md` § Per Member): an Org
  // locking its colour has not taken a view on whether somebody reads at
  // night.
  expect(
    await asRole(fixture.acme, 'member', (tx) =>
      setMemberTheme(tx, fixture.acme.members.member, 'dark'),
    ),
  ).toBe(true)
  expect((await rowOf(fixture.acme.members.member)).theme).toBe('dark')
})

test('no Role writes another Member’s appearance — proven against the policies', async () => {
  const target = fixture.acme.members.member

  // An Owner and an Admin have `members_write` on every row in their Org,
  // which is how they change a Role. Appearance is not theirs, and the trigger
  // is what says so — a raise rather than a silent no-op, because the policy
  // does let them through.
  for (const role of ['owner', 'admin'] as const) {
    await expect(
      asRole(
        fixture.acme,
        role,
        (tx) => tx`
        update members set theme = 'dark' where id = ${target}
      `,
      ),
    ).rejects.toThrow(/appearance is the member/)

    await expect(
      asRole(
        fixture.acme,
        role,
        (tx) => tx`
        update members
           set accent_seed = ${BLUE}, accent_tones = ${tx.json(resolveAccent(BLUE))}
         where id = ${target}
      `,
      ),
    ).rejects.toThrow(/appearance is the member/)
  }

  // A Manager, another Org's Owner and a signed-in stranger do not reach the
  // row at all: `members_write` refuses it before any trigger runs, so it is a
  // write that touched nothing rather than a raise. Worth asserting as the
  // *other* shape — the two refusals are not interchangeable, and a test that
  // accepted either would pass if the trigger were dropped.
  for (const [who, userId] of [
    ['a Manager in the same Org', fixture.acme.users.manager],
    ['another Org’s owner', fixture.globex.users.owner],
    ['a stranger', fixture.stranger.userId],
  ] as const) {
    const written = await asUser(
      userId,
      (tx) => tx`
      update members set theme = 'dark' where id = ${target}
    `,
    )
    expect(written.count, who).toBe(0)
  }

  expect(await rowOf(target)).toEqual({ accent_seed: null, theme: 'system' })
})

test('a Member writes their own appearance, whatever their Role', async () => {
  for (const role of ['owner', 'admin', 'manager', 'member'] as const) {
    expect(
      await asRole(fixture.acme, role, (tx) =>
        setMemberTheme(tx, fixture.acme.members[role], 'light'),
      ),
    ).toBe(true)
  }
})

test('the Org’s default is an Owner’s or an Admin’s, and nobody else’s', async () => {
  for (const role of ['owner', 'admin'] as const) {
    expect(
      await asRole(fixture.acme, role, (tx) =>
        setOrgAccent(tx, fixture.acme.id, {
          seed: BLUE,
          tones: resolveAccent(BLUE),
        }),
      ),
    ).toBe(true)
  }

  for (const role of ['manager', 'member'] as const) {
    expect(
      await asRole(fixture.acme, role, (tx) =>
        setOrgAccent(tx, fixture.acme.id, {
          seed: '#2E9191',
          tones: resolveAccent('#2E9191'),
        }),
      ),
    ).toBe(false)
    expect(
      await asRole(fixture.acme, role, (tx) =>
        setOrgAccentLock(tx, fixture.acme.id, true),
      ),
    ).toBe(false)
  }

  const [org] = await sql<{ accent_seed: string; accent_locked: boolean }[]>`
    select accent_seed, accent_locked from orgs where id = ${fixture.acme.id}
  `
  expect(org).toEqual({ accent_seed: BLUE, accent_locked: false })
})

test('the database refuses a seed that is not canonical hex', async () => {
  for (const bad of ['#d97757', 'D97757', '#fff', 'rebeccapurple']) {
    await expect(
      asRole(
        fixture.acme,
        'owner',
        (tx) => tx`
        update orgs set accent_seed = ${bad} where id = ${fixture.acme.id}
      `,
      ),
    ).rejects.toThrow(/accent_seed_check/)
  }
})

test('a Member’s seed and its tones are written together or not at all', async () => {
  // A seed with no tones is an accent nothing can paint; tones with no seed is
  // an accent nobody can edit.
  await expect(
    asRole(
      fixture.acme,
      'member',
      (tx) => tx`
      update members set accent_seed = ${BLUE}
       where id = ${fixture.acme.members.member}
    `,
    ),
  ).rejects.toThrow(/accent_pair_check/)
})

test('only light, dark and system are themes', async () => {
  await expect(
    asRole(
      fixture.acme,
      'member',
      (tx) => tx`
      update members set theme = 'sepia'
       where id = ${fixture.acme.members.member}
    `,
    ),
  ).rejects.toThrow(/theme_check/)
})

test('the cookie round-trips, and a tampered one is refused', async () => {
  const encoded = encodeAppearance({ theme: 'dark', tones: CLAY })
  // Positional and compact, because it travels on every request.
  expect(encoded).toBe('dark:DA7453,390B00,BA5C3D,9B4427,FFB59E,FFEDE8,5D1800')
  expect(decodeAppearance(encoded)).toEqual({ theme: 'dark', tones: CLAY })

  for (const bad of [
    undefined,
    '',
    'dark',
    'sepia:DA7453,390B00,BA5C3D,9B4427,FFB59E,FFEDE8,5D1800',
    // One tone short.
    'dark:DA7453,390B00,BA5C3D,9B4427,FFB59E,FFEDE8',
    // Not hex, and the shape a CSS injection would need.
    'dark:red;}html{,390B00,BA5C3D,9B4427,FFB59E,FFEDE8,5D1800',
  ]) {
    expect(decodeAppearance(bad), String(bad)).toBeNull()
  }
})
