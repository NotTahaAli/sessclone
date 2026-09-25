import { createHash } from 'node:crypto'

import { beforeEach, expect, test } from 'vitest'

import {
  acceptFailure,
  acceptInvitation,
  acceptOwnInvitation,
  declineOwnInvitation,
  generateInviteToken,
  invite,
  listInvitations,
  ownInvitations,
  revokeInvitation,
} from '../lib/invitations'
import { leaveOrg } from '../lib/members'
import {
  asRole,
  asUser,
  owner as sql,
  seedFixture,
  type Fixture,
} from './harness'

// Ticket 49. An invitation is a capability, so what is worth proving is every
// way it must stop working: the wrong person, the second use, the late use,
// the withdrawn one, and the one that would buy a Seat the Tier does not sell.

let fixture: Fixture

const hashOf = (token: string) =>
  createHash('sha256').update(token).digest('hex')

beforeEach(async () => {
  fixture = await seedFixture()
})

const STRANGER = 'stranger@nowhere.test'

/** A Tier with a ceiling, and the Org on it. */
const capSeats = async (orgId: string, maxSeats: number | null) => {
  const [tier] = await sql<{ id: string }[]>`
    insert into tiers (key, name, description, seat_price_usd, max_seats,
                       retention_max_days, archival_available, sort_order)
    values (${`cap-${maxSeats ?? 'none'}-${orgId.slice(0, 8)}`}, 'Capped',
            'A tier with a ceiling.', 10, ${maxSeats}, 365, true, 1)
    returning id
  `
  await sql`
    insert into subscriptions (org_id, tier_id, status)
    values (${orgId}, ${tier!.id}, 'active')
  `
}

const invited = (email = STRANGER) =>
  asRole(fixture.acme, 'owner', (tx) =>
    invite(tx, fixture.acme.id, email, 'member', fixture.acme.members.owner),
  )

/**
 * Accepting as a signed-in person, with the refusal as a sentence.
 *
 * The `try` is outside the transaction on purpose: a raise aborts it, so the
 * error surfaces again when the transaction ends however the statement was
 * wrapped. This is the shape every caller has to use.
 */
const accept = async (userId: string, token: string, email?: string) => {
  // The session's verified address; the account's own, unless a test says
  // the identity provider now reports another.
  const [account] = await sql<{ email: string }[]>`
    select email from users where id = ${userId}
  `
  const verified = email ?? account!.email
  try {
    return {
      orgId: await asUser(userId, (tx) =>
        acceptInvitation(tx, token, verified),
      ),
    }
  } catch (error) {
    return { error: acceptFailure(error) }
  }
}

const seatsUsed = async (orgId: string) => {
  const [row] = await sql<{ seats: number }[]>`
    select sessclone_org_seats(${orgId}) as seats
  `
  return row!.seats
}

test('an invitation is accepted once, and lands the person in the Org', async () => {
  const { token } = await invited()

  const result = await accept(fixture.stranger.userId, token)

  expect(result).toEqual({ orgId: fixture.acme.id })

  const [member] = await sql<{ role: string }[]>`
    select role from members
     where org_id = ${fixture.acme.id} and user_id = ${fixture.stranger.userId}
  `
  expect(member!.role).toBe('member')

  // The second use is refused, so a link that leaks after the fact is spent.
  const replay = await accept(fixture.stranger.userId, token)
  expect(replay).toEqual({ error: 'This invitation is not valid.' })
})

test('the Role invited is the Role granted', async () => {
  const { token } = await asRole(fixture.acme, 'owner', (tx) =>
    invite(
      tx,
      fixture.acme.id,
      STRANGER,
      'manager',
      fixture.acme.members.owner,
    ),
  )
  await accept(fixture.stranger.userId, token)

  const [member] = await sql<{ role: string }[]>`
    select role from members where user_id = ${fixture.stranger.userId}
  `
  expect(member!.role).toBe('manager')
})

test('somebody else holding the link cannot use it', async () => {
  const { token } = await invited()

  // Signed in, real account, wrong address: the link is not a bearer token
  // for whoever opens it.
  const result = await accept(fixture.globex.users.member, token)

  expect(result).toEqual({
    error: 'This invitation was sent to a different address.',
  })
  expect(await seatsUsed(fixture.acme.id)).toBe(5)
})

test('an expired invitation is refused', async () => {
  // Seeded expired rather than aged, because `expires_at` is pinned once the
  // invitation is sent — an Admin cannot extend or shorten a link somebody
  // already holds.
  const { token, hash } = generateInviteToken()
  await sql`
    insert into invitations (org_id, email, role, token_hash, expires_at)
    values (${fixture.acme.id}, ${STRANGER}, 'member', ${hash},
            now() - interval '1 day')
  `

  const result = await accept(fixture.stranger.userId, token)

  expect(result).toEqual({
    error: 'This invitation has expired. Ask for another.',
  })
})

test('a withdrawn invitation is refused', async () => {
  const { token, id } = await invited()

  expect(
    await asRole(fixture.acme, 'admin', (tx) =>
      revokeInvitation(tx, fixture.acme.id, id),
    ),
  ).toBe(true)

  expect(await accept(fixture.stranger.userId, token)).toEqual({
    error: 'This invitation is not valid.',
  })
})

test('a full Org refuses the acceptance, without telling a stranger its size', async () => {
  // The ceiling is set to exactly the Seats already in use.
  await capSeats(fixture.acme.id, await seatsUsed(fixture.acme.id))
  const { token } = await invited()

  const result = await accept(fixture.stranger.userId, token)

  expect(result).toEqual({
    // The raise names the count; the sentence shown to somebody who is not in
    // the Org does not.
    error: 'This Org has no seat free. Whoever invited you can free one.',
  })

  const rows =
    await sql`select 1 from members where user_id = ${fixture.stranger.userId}`
  expect(rows).toHaveLength(0)
})

test('a removed Member costs no Seat, so removing one frees it', async () => {
  const before = await seatsUsed(fixture.acme.id)
  await capSeats(fixture.acme.id, before)

  await asRole(
    fixture.acme,
    'owner',
    (tx) =>
      tx`update members set removed_at = now()
          where id = ${fixture.acme.members.manager}`,
  )
  expect(await seatsUsed(fixture.acme.id)).toBe(before - 1)

  const { token } = await invited()
  expect(await accept(fixture.stranger.userId, token)).toEqual({
    orgId: fixture.acme.id,
  })
})

test('somebody who left can be invited back', async () => {
  // `members` keeps the row so the Turns still reconcile, so re-admission is
  // an update rather than an insert — and the person doing it is not an Admin
  // of the Org they are rejoining.
  const [account] = await sql<{ email: string }[]>`
    select email from users where id = ${fixture.acme.users.removed}
  `
  const { token } = await invited(account!.email)

  expect(await accept(fixture.acme.users.removed, token)).toEqual({
    orgId: fixture.acme.id,
  })

  const [member] = await sql<{ removed_at: Date | null }[]>`
    select removed_at from members where id = ${fixture.acme.members.removed}
  `
  expect(member!.removed_at).toBeNull()
})

test('only an Owner or an Admin may invite', async () => {
  const refused = (['manager', 'member'] as const).map((role) =>
    asRole(fixture.acme, role, (tx) =>
      invite(
        tx,
        fixture.acme.id,
        STRANGER,
        'member',
        fixture.acme.members.owner,
      ),
    ),
  )

  // The policy refuses the insert outright, so nothing reaches the table and
  // there is no half-written invitation to clean up.
  await Promise.all(
    refused.map((attempt) =>
      expect(attempt).rejects.toThrow(/row-level security/),
    ),
  )
})

test('another Org neither lists nor withdraws these invitations', async () => {
  const { id } = await invited()

  const { invitations } = await asRole(fixture.globex, 'owner', (tx) =>
    listInvitations(tx, fixture.acme.id),
  )
  expect(invitations).toEqual([])

  expect(
    await asRole(fixture.globex, 'owner', (tx) =>
      revokeInvitation(tx, fixture.acme.id, id),
    ),
  ).toBe(false)
})

test('the list marks what is live, and a Member cannot read it at all', async () => {
  const { id } = await invited()
  await invited('someone.else@nowhere.test')
  await asRole(fixture.acme, 'owner', (tx) =>
    revokeInvitation(tx, fixture.acme.id, id),
  )

  const { invitations } = await asRole(fixture.acme, 'admin', (tx) =>
    listInvitations(tx, fixture.acme.id),
  )
  expect(
    invitations
      .map((row) => row.live)
      .toSorted((a, b) => Number(a) - Number(b)),
  ).toEqual([false, true])

  const asMember = await asRole(fixture.acme, 'member', (tx) =>
    listInvitations(tx, fixture.acme.id),
  )
  expect(asMember.invitations).toEqual([])
})

test('a second live invitation to one address is refused', async () => {
  await invited()
  await expect(invited()).rejects.toThrow(/duplicate key|unique/i)
})

test('the token is never stored, only its hash', async () => {
  const { token } = await invited()
  const [row] = await sql<{ token_hash: string }[]>`
    select token_hash from invitations
  `
  expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/)
  expect(row!.token_hash).not.toContain(token)
})

test('an invitation cannot be re-pointed after it is sent', async () => {
  const { id } = await invited()

  await expect(
    asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update invitations set role = 'admin' where id = ${id}`,
    ),
  ).rejects.toThrow(/fixed once sent/)
})

test('an account cannot rename itself onto somebody else’s invitation', async () => {
  // The whole design rests on matching the invited address against the
  // signed-in person's own, and `users_write_self` lets a person write their
  // own row. Without the column guard, this is how an invitation becomes a
  // bearer token for any account.
  const { token } = await invited('victim@corp.example')

  await expect(
    asUser(
      fixture.stranger.userId,
      (tx) =>
        tx`update users set email = 'victim@corp.example'
            where id = ${fixture.stranger.userId}`,
    ),
  ).rejects.toThrow(/identity provider/)

  expect(await accept(fixture.stranger.userId, token)).toEqual({
    error: expect.stringMatching(/different address/),
  })
})

test('somebody invited back comes back at the Role the invitation granted', async () => {
  // The conflicting row is a tombstone, so there is no incumbent Role to
  // protect: an Admin who left and is invited back as a Member is a Member.
  await asRole(
    fixture.acme,
    'owner',
    (tx) =>
      tx`update members set role = 'admin'
          where id = ${fixture.acme.members.removed}`,
  )
  const [account] = await sql<{ email: string }[]>`
    select email from users where id = ${fixture.acme.users.removed}
  `
  const { token } = await invited(account!.email)

  expect(await accept(fixture.acme.users.removed, token)).toEqual({
    orgId: fixture.acme.id,
  })

  const [member] = await sql<
    { role: string; archival_enabled: boolean; removed_at: Date | null }[]
  >`
    select role, archival_enabled, removed_at from members
     where id = ${fixture.acme.members.removed}
  `
  expect(member).toMatchObject({
    role: 'member',
    // Consent given by a membership that ended does not carry over.
    archival_enabled: false,
    removed_at: null,
  })
})

test('a spent invitation cannot be made live again', async () => {
  const { id, token } = await invited()
  await accept(fixture.stranger.userId, token)

  await expect(
    asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update invitations set accepted_at = null where id = ${id}`,
    ),
  ).rejects.toThrow(/stays accepted/)

  const { id: withdrawn } = await invited('other@nowhere.test')
  await asRole(fixture.acme, 'owner', (tx) =>
    revokeInvitation(tx, fixture.acme.id, withdrawn),
  )
  await expect(
    asRole(
      fixture.acme,
      'owner',
      (tx) =>
        tx`update invitations set revoked_at = null where id = ${withdrawn}`,
    ),
  ).rejects.toThrow(/stays withdrawn/)
})

test('two people accepting at once cannot both take the last Seat', async () => {
  // The row lock serialises two acceptances of the *same* invitation. Two
  // different invitations lock two different rows, so without a lock on the
  // Org both count the seats before either insert commits.
  const before = await seatsUsed(fixture.acme.id)
  await capSeats(fixture.acme.id, before + 1)

  const [first, second] = await sql<{ id: string; email: string }[]>`
    select id, email from users
     where id in (${fixture.stranger.userId}, ${fixture.platformAdmin.userId})
  `
  const tokens = await Promise.all([
    invited(first!.email),
    invited(second!.email),
  ])

  const results = await Promise.all([
    accept(first!.id, tokens[0].token),
    accept(second!.id, tokens[1].token),
  ])

  expect(results.filter((result) => 'orgId' in result)).toHaveLength(1)
  expect(await seatsUsed(fixture.acme.id)).toBe(before + 1)
})

test('a platform admin cannot rename themselves onto a pending invitation', async () => {
  // The exemption on `users.email` exists so an operator can correct an
  // address the identity provider changed. Their own row is the one case it
  // must not cover: the acceptance matches on the address, so renaming
  // yourself onto a live invitation is a way into any Org.
  const { token } = await invited()

  await expect(
    asUser(
      fixture.platformAdmin.userId,
      (tx) =>
        tx`update users set email = ${STRANGER}
            where id = ${fixture.platformAdmin.userId}`,
    ),
  ).rejects.toThrow(/comes from the identity provider/)

  expect(await accept(fixture.platformAdmin.userId, token)).toEqual({
    error: 'This invitation was sent to a different address.',
  })
})

test('a platform admin can correct somebody else’s address', async () => {
  await asUser(
    fixture.platformAdmin.userId,
    (tx) =>
      tx`update users set email = 'corrected@nowhere.test'
          where id = ${fixture.stranger.userId}`,
  )

  const [account] = await sql<{ email: string }[]>`
    select email from users where id = ${fixture.stranger.userId}
  `
  expect(account!.email).toBe('corrected@nowhere.test')
})

// The Org switcher (2026-09-25): the invitee answers an invitation from the
// dashboard, by id, through definer functions keyed on the session's verified
// address. They still read nothing of `invitations` directly.

/** The refusal a definer function raised, or null when it did not. */
const refusal = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : 'raised'),
  )

/** Seeded expired: `expires_at` is pinned once an invitation is sent. */
const lapsed = async (orgId: string, email: string, ago: string) => {
  const [row] = await sql<{ id: string }[]>`
    insert into invitations (org_id, email, role, token_hash, expires_at)
    values (${orgId}, ${email}, 'member', ${generateInviteToken().hash},
            now() - ${ago}::interval)
    returning id
  `
  return row!.id
}

const mine = (userId: string, email: string) =>
  asUser(userId, (tx) => ownInvitations(tx, email))

test('the switcher lists what is addressed to the verified address alone', async () => {
  const { id } = await invited('Stranger@Nowhere.test')
  await invited('someone-else@nowhere.test')
  // Addressed to Acme's Owner, but into the Org they are already in.
  await invited('owner@acme.test')
  // Expired more than a week ago.
  await lapsed(fixture.globex.id, STRANGER, '8 days')

  const listed = await mine(fixture.stranger.userId, STRANGER)
  expect(listed).toEqual([
    {
      id,
      orgName: 'Acme',
      role: 'member',
      invitedBy: 'owner@acme.test',
      expiresAt: expect.any(Date),
    },
  ])

  // Somebody else asking with their own address sees none of it, and an
  // Owner of Acme sees their own inbox, not their Org's outbox.
  expect(await mine(fixture.acme.users.owner, 'owner@acme.test')).toEqual([])
  expect(await mine(fixture.globex.users.owner, 'owner@globex.test')).toEqual(
    [],
  )

  // Nor can the invitee read the table itself.
  expect(
    await asUser(
      fixture.stranger.userId,
      (tx) => tx`select id from invitations`,
    ),
  ).toHaveLength(0)
})

test('an expired invitation is listed for a week, and dismissing it hides it', async () => {
  const id = await lapsed(fixture.acme.id, STRANGER, '6 days')
  expect(
    (await mine(fixture.stranger.userId, STRANGER)).map((one) => one.id),
  ).toEqual([id])

  await asUser(fixture.stranger.userId, (tx) =>
    declineOwnInvitation(tx, id, STRANGER),
  )
  expect(await mine(fixture.stranger.userId, STRANGER)).toEqual([])

  // The Org reads it as expired, not declined: it lapsed before anyone said no.
  const { invitations } = await asRole(fixture.acme, 'owner', (tx) =>
    listInvitations(tx, fixture.acme.id),
  )
  expect(invitations[0]).toMatchObject({ id, declined: false, live: false })
})

test('accepting by id joins as the invited Role and returns the membership', async () => {
  const { id } = await invited()

  const member = await asUser(fixture.stranger.userId, (tx) =>
    acceptOwnInvitation(tx, id, STRANGER),
  )

  const [row] = await sql<{ org_id: string; role: string }[]>`
    select org_id, role from members where id = ${member}
       and user_id = ${fixture.stranger.userId}
  `
  expect(row).toEqual({ org_id: fixture.acme.id, role: 'member' })
})

test('accepting by id refuses another address, and anything not live', async () => {
  const { id } = await invited()
  const other = await invited('other@nowhere.test')
  const declined = await invited('declined@nowhere.test')
  await sql`update invitations set declined_at = now() where id = ${declined.id}`
  const expired = {
    id: await lapsed(fixture.acme.id, 'late@nowhere.test', '1 day'),
  }
  const accepting = (invitationId: string, email: string) =>
    refusal(
      asUser(fixture.stranger.userId, (tx) =>
        acceptOwnInvitation(tx, invitationId, email),
      ),
    )

  expect(await accepting(other.id, STRANGER)).toMatch(/different address/)
  expect(await accepting(declined.id, 'declined@nowhere.test')).toMatch(
    /not valid/,
  )
  expect(await accepting(expired.id, 'late@nowhere.test')).toMatch(/expired/)
  // And one that is theirs still works after all of that.
  expect(await accepting(id, STRANGER)).toBeNull()
})

test('the verified address decides, not the one stored on the account', async () => {
  // The identity provider now reports a new address; `users.email` still
  // holds the one from the first sign-in and cannot be edited to follow.
  const moved = 'moved@nowhere.test'
  const toNew = await invited(moved)
  const toOld = await invited(STRANGER)

  expect(await accept(fixture.stranger.userId, toOld.token, moved)).toEqual({
    error: 'This invitation was sent to a different address.',
  })
  expect(await accept(fixture.stranger.userId, toNew.token, moved)).toEqual({
    orgId: fixture.acme.id,
  })
})

test('declining hides it from the invitee, tells the Org, and frees a re-invite', async () => {
  const { id } = await invited()

  expect(
    await refusal(
      asUser(fixture.acme.users.member, (tx) =>
        declineOwnInvitation(tx, id, 'member@acme.test'),
      ),
    ),
  ).toMatch(/not valid/)

  await asUser(fixture.stranger.userId, (tx) =>
    declineOwnInvitation(tx, id, STRANGER),
  )

  expect(await mine(fixture.stranger.userId, STRANGER)).toEqual([])
  const { invitations } = await asRole(fixture.acme, 'owner', (tx) =>
    listInvitations(tx, fixture.acme.id),
  )
  expect(invitations[0]).toMatchObject({ id, declined: true, live: false })

  // Declined is final, and the Admin may ask again.
  expect(
    await refusal(
      asUser(fixture.stranger.userId, (tx) =>
        declineOwnInvitation(tx, id, STRANGER),
      ),
    ),
  ).toMatch(/not valid/)
  await expect(invited()).resolves.toMatchObject({ id: expect.any(String) })
})

test('the dashboard role cannot mark an invitation declined', async () => {
  const { id } = await invited()

  await expect(
    asRole(
      fixture.acme,
      'owner',
      (tx) => tx`update invitations set declined_at = now() where id = ${id}`,
    ),
  ).rejects.toThrow(/only the person invited/)
})

test('a Member leaves an Org; the last Owner cannot, and nobody leaves for another', async () => {
  await asRole(fixture.acme, 'member', (tx) =>
    leaveOrg(tx, fixture.acme.members.member),
  )
  const [left] = await sql<{ removed_at: Date | null }[]>`
    select removed_at from members where id = ${fixture.acme.members.member}
  `
  expect(left!.removed_at).toBeInstanceOf(Date)

  expect(
    await refusal(
      asRole(fixture.acme, 'owner', (tx) =>
        leaveOrg(tx, fixture.acme.members.owner),
      ),
    ),
  ).toMatch(/at least one owner/)
  expect(
    await refusal(
      asRole(fixture.acme, 'owner', (tx) =>
        leaveOrg(tx, fixture.acme.members.admin),
      ),
    ),
  ).toMatch(/not a member/)

  // With a second Owner, the first may go.
  await asRole(
    fixture.acme,
    'owner',
    (tx) =>
      tx`update members set role = 'owner' where id = ${fixture.acme.members.admin}`,
  )
  expect(
    await refusal(
      asRole(fixture.acme, 'owner', (tx) =>
        leaveOrg(tx, fixture.acme.members.owner),
      ),
    ),
  ).toBeNull()

  // And leaving by hand, around the function, is still refused.
  await expect(
    asRole(
      fixture.acme,
      'manager',
      (tx) =>
        tx`update members set removed_at = now() where id = ${fixture.acme.members.manager}`,
    ),
  ).rejects.toThrow()
})

test('the app deployed before this migration still accepts by link, re-admission included', async () => {
  // The SQL reaches production before the new app does, and the app already
  // there calls the one-argument form. It must keep working in between.
  const [account] = await sql<{ email: string }[]>`
    select email from users where id = ${fixture.acme.users.removed}
  `
  const back = await invited(account!.email)
  const fresh = await invited()
  const oldCall = (userId: string, token: string) =>
    asUser(
      userId,
      (tx) => tx<{ org: string }[]>`
        select sessclone_accept_invitation(
          ${hashOf(token)}
        ) as org
      `,
    ).then(([row]) => row!.org)

  expect(await oldCall(fixture.acme.users.removed, back.token)).toBe(
    fixture.acme.id,
  )
  expect(await oldCall(fixture.stranger.userId, fresh.token)).toBe(
    fixture.acme.id,
  )
  const rows = await sql<{ user_id: string }[]>`
    select user_id from members
     where org_id = ${fixture.acme.id} and removed_at is null
       and user_id in (${fixture.acme.users.removed}, ${fixture.stranger.userId})
  `
  expect(rows).toHaveLength(2)
})

test('two Owners leaving at once cannot leave the Org with none', async () => {
  await asRole(
    fixture.acme,
    'owner',
    (tx) =>
      tx`update members set role = 'owner' where id = ${fixture.acme.members.admin}`,
  )
  // Both statements run before either commits: the rule is checked at
  // commit, so this is the interleaving that matters.
  let release!: () => void
  const both = new Promise<void>((resolve) => (release = resolve))
  let ran = 0
  const leaving = (role: 'owner' | 'admin') =>
    refusal(
      asRole(fixture.acme, role, async (tx) => {
        await leaveOrg(tx, fixture.acme.members[role])
        if (++ran === 2) release()
        await both
      }),
    )

  const results = await Promise.all([leaving('owner'), leaving('admin')])

  expect(results.filter((result) => result === null)).toHaveLength(1)
  expect(results.find((result) => result !== null)).toMatch(
    /at least one owner/,
  )
  const [left] = await sql<{ owners: number }[]>`
    select sessclone_org_owners(${fixture.acme.id}) as owners
  `
  expect(left!.owners).toBe(1)
})

test('accepting takes no Org lock of its own: the seat trigger is the one copy', async () => {
  // `20260922040000_admin_review.sql` removed a second copy of the seat rule
  // from the acceptance because it took the Org lock before the row lock, the
  // reverse of `members_guard_seat_ceiling`, and could deadlock. The seat
  // behaviour is proven above; this pins that the copy stays gone.
  const [row] = await sql<{ body: string }[]>`
    select pg_get_functiondef(
      'sessclone_accept_own_invitation(uuid, text)'::regprocedure
    ) as body
  `
  expect(row!.body).not.toMatch(/advisory|max_seats/)
})
