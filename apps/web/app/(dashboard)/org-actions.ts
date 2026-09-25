'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { asViewer } from '../../lib/db'
import {
  acceptFailure,
  acceptOwnInvitation,
  declineOwnInvitation,
} from '../../lib/invitations'
import { leaveOrg } from '../../lib/members'
import { sessionUser } from '../../lib/supabase/server'
import { MEMBER_COOKIE, MEMBER_COOKIE_OPTIONS } from '../../lib/viewer'

// The Org switcher's four writes. Every one starts from `sessionUser()`, not
// `signedInUser()`: somebody whose current Org is waiting for approval must
// still be able to switch out of it, answer an invitation, or leave. Identity
// and the verified address come from the session; the ids in the form are
// parsed and then checked by the database as the person.

export type OrgActionState = { error: string } | null

const Id = z.uuid()

/** Opens another of the viewer's Orgs, on this device. */
export const switchOrg = async (
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> => {
  const user = await sessionUser()
  if (!user) return { error: 'Sign in again to switch Org.' }

  const memberId = Id.safeParse(formData.get('memberId'))
  if (!memberId.success) return { error: 'That is not one of your Orgs.' }

  // The cookie is a hint `sessionViewer` re-checks on every request, so this
  // check is courtesy — an unknown id gets a sentence, and the cookie stays.
  const [mine] = await asViewer(
    user.id,
    (tx) => tx`
      select 1 from members
       where id = ${memberId.data}
         and id in (select sessclone_own_member_ids())
    `,
  )
  if (!mine) return { error: 'That is not one of your Orgs.' }

  const store = await cookies()
  store.set(MEMBER_COOKIE, memberId.data, MEMBER_COOKIE_OPTIONS)
  redirect('/costs')
  return null
}

/** Accepts an invitation addressed to the viewer, and opens that Org. */
export const acceptInvite = async (
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> => {
  const user = await sessionUser()
  if (!user) return { error: 'Sign in again to accept.' }

  const id = Id.safeParse(formData.get('invitationId'))
  if (!id.success) return { error: 'This invitation is not valid.' }

  let memberId: string
  try {
    memberId = await asViewer(user.id, (tx) =>
      acceptOwnInvitation(tx, id.data, user.email),
    )
  } catch (error) {
    // Outside the transaction: a raise aborts it (see `join/[token]`).
    return { error: acceptFailure(error) }
  }

  const store = await cookies()
  store.set(MEMBER_COOKIE, memberId, MEMBER_COOKIE_OPTIONS)
  redirect('/costs')
  return null
}

/** Declines an invitation, or dismisses an expired one. */
export const declineInvite = async (
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> => {
  const user = await sessionUser()
  if (!user) return { error: 'Sign in again to decline.' }

  const id = Id.safeParse(formData.get('invitationId'))
  if (!id.success) return { error: 'This invitation is not valid.' }

  try {
    await asViewer(user.id, (tx) =>
      declineOwnInvitation(tx, id.data, user.email),
    )
  } catch {
    return { error: 'This invitation is not valid.' }
  }

  revalidatePath('/', 'layout')
  return null
}

/**
 * Leaves the Org named by one of the viewer's own memberships. The database
 * refuses anybody else's membership and the last Owner.
 */
export const leaveCurrentOrg = async (
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> => {
  const user = await sessionUser()
  if (!user) return { error: 'Sign in again to leave.' }

  const memberId = Id.safeParse(formData.get('memberId'))
  if (!memberId.success) return { error: 'That is not one of your Orgs.' }

  try {
    await asViewer(user.id, (tx) => leaveOrg(tx, memberId.data))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return {
      error: /at least one owner/i.test(message)
        ? 'You are its only Owner. Make somebody else an Owner in Members first.'
        : /only org/i.test(message)
          ? 'This is your only Org, so there is nowhere to go from it.'
          : 'That Org could not be left.',
    }
  }

  // The choice named the Org just left; the usual order decides from here.
  const store = await cookies()
  store.delete(MEMBER_COOKIE)
  redirect('/costs')
  return null
}
