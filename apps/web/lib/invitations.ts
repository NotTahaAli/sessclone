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
  /** Live: not accepted, not revoked, not yet expired. */
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
  live: boolean
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

/** The link's secret, and what is stored in its place. */
export const generateInviteToken = () => {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
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
           (accepted_at is null and revoked_at is null and expires_at > now())
             as live
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
  invitationId: string,
): Promise<boolean> => {
  const rows = await tx`
    update invitations set revoked_at = now()
     where id = ${invitationId}
       and accepted_at is null
       and revoked_at is null
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
 */
export const acceptInvitation = async (
  tx: TransactionSql,
  token: string,
): Promise<string> => {
  const rows = await tx<{ org: string }[]>`
    select sessclone_accept_invitation(${hashToken(token)}) as org
  `
  return rows[0]!.org
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
