import { createHash, randomBytes } from 'node:crypto'

import type { TransactionSql } from 'postgres'

import type { Role } from './viewer'

// Ticket 49: an invitation is a capability, and the seat limit is checked when
// it is used.
//
// The token is 256 bits from `randomBytes` and only its sha256 is stored, for
// the reasons `api-keys.ts` sets out at length: there is nothing to guess, so
// a slow hash buys nothing, and a plain hash is one indexed lookup. What it
// buys here is that an Admin reading `invitations` — the only Role that can —
// cannot replay a link they did not receive.
//
// Nothing in this file decides who may invite or who may join. `invitations`
// carries its policies and `sessclone_accept_invitation` carries the rest of
// the rules (expiry, replay, the address, the seat), because acceptance is
// done by somebody who is not yet in the Org and so may read none of it.

/** The Roles an invitation may name. Never Owner: see the migration. */
export type InvitedRole = Exclude<Role, 'owner'>

export const INVITED_ROLES: InvitedRole[] = ['admin', 'manager', 'member']

export type Invitation = {
  id: string
  email: string
  role: InvitedRole
  createdAt: Date
  expiresAt: Date
  acceptedAt: Date | null
  revokedAt: Date | null
  /** Turned down by the person invited, before it expired. A dismissed
   * expired one reads as expired. */
  declined: boolean
  /** Live: not accepted, revoked or declined, and not yet expired. */
  live: boolean
}

type InvitationRow = {
  id: string
  email: string
  role: InvitedRole
  created_at: Date
  expires_at: Date
  accepted_at: Date | null
  revoked_at: Date | null
  declined: boolean
  live: boolean
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/** The link's secret, and what is stored in its place. */
export const generateInviteToken = () => {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

/**
 * The Org an invitation names, for the sign-in page somebody reached from one
 * (ticket 77). Null for a token that is spent, revoked, expired or invented —
 * one answer for all four, as everything else about an invitation gives.
 *
 * Runs with no viewer: whoever is following the link is signed out, which is
 * why `sessclone_invitation_org` is `security definer` and why the token's
 * hash is the only thing authorising it.
 */
export const invitationOrg = async (
  tx: TransactionSql,
  token: string,
): Promise<{ orgId: string; orgName: string; logo: Date | null } | null> => {
  const [row] = await tx<
    { org_id: string; org_name: string; logo_updated_at: Date | null }[]
  >`select * from sessclone_invitation_org(${hashToken(token)})`
  return row
    ? { orgId: row.org_id, orgName: row.org_name, logo: row.logo_updated_at }
    : null
}

/** Where an invitation is accepted. Relative: the caller knows the origin. */
export const invitePath = (token: string) =>
  `/join/${encodeURIComponent(token)}`

/**
 * Invites an address into the Org, and returns the link to send.
 *
 * The link is returned rather than only mailed because the mail may not go
 * anywhere: this deployment's SMTP is a setting, and an invitation nobody can
 * pass on is worse than one an Owner copies into a chat. Whoever holds it can
 * join, so it is shown once, to the person who created it.
 */
export const invite = async (
  tx: TransactionSql,
  orgId: string,
  email: string,
  role: InvitedRole,
  invitedBy: string,
): Promise<{ id: string; token: string }> => {
  const { token, hash } = generateInviteToken()

  // `invitations_create` is Owner or Admin, and a `with check` refusal raises
  // rather than writing nothing — so there is no silent-failure branch here,
  // and the caller turns the raise into a sentence.
  const rows = await tx<{ id: string }[]>`
    insert into invitations (org_id, email, role, token_hash, invited_by)
    values (${orgId}, ${email}, ${role}, ${hash}, ${invitedBy})
    returning id
  `

  return { id: rows[0]!.id, token }
}

/**
 * The Org's invitations, newest first, under `invitations_read`.
 *
 * Bounded like `listOrgMembers`, and for the same reason: a page renders a
 * control per row. An Org that outgrows this needs search on this screen.
 */
export const listInvitations = async (
  tx: TransactionSql,
  orgId: string,
  limit = 100,
): Promise<{ invitations: Invitation[]; more: boolean }> => {
  const rows = await tx<InvitationRow[]>`
    select id, email, role, created_at, expires_at, accepted_at, revoked_at,
           coalesce(declined_at < expires_at, false) as declined,
           (accepted_at is null and revoked_at is null and declined_at is null
            and expires_at > now()) as live
      from invitations
     where org_id = ${orgId}
     order by created_at desc
     limit ${limit + 1}
  `

  return {
    invitations: rows.slice(0, limit).map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
      declined: row.declined,
      live: row.live,
    })),
    more: rows.length > limit,
  }
}

/**
 * Withdraws an invitation that has not been used.
 *
 * Returns whether a row was written: refused by the policy, already accepted
 * or already revoked all touch nothing. The Members page does not surface the
 * answer — it re-renders the list, which is where a withdrawal that did not
 * happen is visible as the invitation still being there.
 */
export const revokeInvitation = async (
  tx: TransactionSql,
  orgId: string,
  invitationId: string,
): Promise<boolean> => {
  const rows = await tx`
    update invitations set revoked_at = now()
     where id = ${invitationId}
       and org_id = ${orgId}
       and accepted_at is null
       and revoked_at is null
       and declined_at is null
     returning id
  `
  return rows.length > 0
}

/**
 * Accepts an invitation and returns the Org joined.
 *
 * Every rule lives in `sessclone_accept_invitation`, which raises a sentence
 * when it refuses — expired, replayed, addressed to somebody else, or a full
 * Org. The message is written for the person holding the link, so it is passed
 * through rather than replaced.
 *
 * `email` is the signed-in session's verified address (`sessionUser().email`),
 * never `users.email`: the invitation is for an address, and the identity
 * provider is what vouches for it (Taha, 2026-09-25).
 */
export const acceptInvitation = async (
  tx: TransactionSql,
  token: string,
  email: string,
): Promise<string> => {
  const rows = await tx<{ org: string }[]>`
    select sessclone_accept_invitation(${hashToken(token)}, ${email}) as org
  `
  return rows[0]!.org
}

/** An invitation addressed to the viewer, as the Org switcher lists it. */
export type OwnInvitation = {
  id: string
  orgName: string
  role: InvitedRole
  /** The inviting Member's name or address, or null once they have left. */
  invitedBy: string | null
  expiresAt: Date
}

/**
 * The invitations addressed to the viewer's verified address: open ones, and
 * expired ones for a week after, until dismissed. Through a definer function,
 * because the invitee reads nothing of `invitations` directly.
 */
export const ownInvitations = async (
  tx: TransactionSql,
  email: string,
): Promise<OwnInvitation[]> => {
  const rows = await tx<
    {
      id: string
      org_name: string
      role: InvitedRole
      invited_by: string | null
      expires_at: Date
    }[]
  >`select * from sessclone_own_invitations(${email})`
  return rows.map((row) => ({
    id: row.id,
    orgName: row.org_name,
    role: row.role,
    invitedBy: row.invited_by,
    expiresAt: row.expires_at,
  }))
}

/** Accepts one of the viewer's own invitations by id; returns the member id. */
export const acceptOwnInvitation = async (
  tx: TransactionSql,
  invitationId: string,
  email: string,
): Promise<string> => {
  const [row] = await tx<{ member: string }[]>`
    select sessclone_accept_own_invitation(${invitationId}, ${email}) as member
  `
  return row!.member
}

/** Declines one of the viewer's own invitations, or dismisses an expired one. */
export const declineOwnInvitation = async (
  tx: TransactionSql,
  invitationId: string,
  email: string,
) => {
  await tx`select sessclone_decline_own_invitation(${invitationId}, ${email})`
}

/**
 * The sentence to show for a refused acceptance.
 *
 * Caught by the caller rather than inside the transaction: a statement that
 * raises leaves the transaction aborted, so the error surfaces again when it
 * ends however carefully the failing statement was wrapped.
 */
export const acceptFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  // An allowlist of the sentences the function actually raises, not a test
  // for words that might appear in one. A driver or permission error can say
  // "invitation" too — `permission denied for function
  // sessclone_accept_invitation` does — and that is exactly the internal
  // detail this page must not hand to a stranger.
  return (
    ACCEPT_FAILURES.find(([raised]) => message.startsWith(raised))?.[1] ??
    'This invitation could not be accepted.'
  )
}

const ACCEPT_FAILURES: [raised: string, shown: string][] = [
  ['sign in before', 'Sign in as the person this invitation was sent to.'],
  ['this invitation is not valid', 'This invitation is not valid.'],
  [
    'this invitation has expired',
    'This invitation has expired. Ask for another.',
  ],
  [
    'this invitation was sent to a different address',
    'This invitation was sent to a different address.',
  ],
  // Without the counts the raise carries: the person reading this is not in
  // the Org, and its headcount is not theirs to know.
  [
    'this Org has no seat free',
    'This Org has no seat free. Whoever invited you can free one.',
  ],
]
