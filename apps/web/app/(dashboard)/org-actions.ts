'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'

import { approvalRequired } from '../../lib/approval'
import { createOwnOrg, PendingOrgExists } from '../../lib/auth/bootstrap'
import { parsePlan } from '../../lib/auth/plan'
import { asViewer } from '../../lib/db'
import {
  acceptFailure,
  acceptOwnInvitation,
  declineOwnInvitation,
} from '../../lib/invitations'
import { leaveOrg } from '../../lib/members'
import { ORG_NAME_RULE, OrgNameInput } from '../../lib/names'
import { notifySignup } from '../../lib/signup-notice'
import { sessionUser } from '../../lib/supabase/server'
import { marketingTiers } from '../../lib/tiers'
import {
  MEMBER_COOKIE,
  MEMBER_COOKIE_OPTIONS,
  sessionViewer,
} from '../../lib/viewer'
import { DEMO_REFUSAL, isDemoUser } from '../../lib/demo'

// The Org switcher's five writes. Every one starts from `sessionUser()`, not
// `signedInUser()`: somebody whose current Org is waiting for approval must
// still be able to switch out of it, answer an invitation, leave, or start
// another. Identity
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
  if (isDemoUser(user.id)) return { error: DEMO_REFUSAL }

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
  if (isDemoUser(user.id)) return { error: DEMO_REFUSAL }

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
 * Leaves the Org the viewer has open. The form names the membership it was
 * drawn for, and a tab left open across a switch names one that is no longer
 * current, so it is refused rather than leaving an Org the viewer is not
 * looking at. The database refuses anybody else's membership and the last
 * Owner.
 */
export const leaveCurrentOrg = async (
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> => {
  const viewer = await sessionViewer()
  // Ticket 141: nobody leaves in their deletion grace; Keep comes first.
  if (!viewer || viewer.deletionRequestedAt) {
    return { error: 'Sign in again to leave.' }
  }
  if (isDemoUser(viewer.userId)) return { error: DEMO_REFUSAL }

  const memberId = Id.safeParse(formData.get('memberId'))
  if (!memberId.success || memberId.data !== viewer.memberId) {
    return { error: 'Reload the page: this is not the Org you have open.' }
  }

  try {
    await asViewer(viewer.userId, (tx) => leaveOrg(tx, viewer.memberId))
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

/**
 * Starts a new Org with the viewer as its Owner, and opens it (ticket 136).
 * The plan is asked for exactly where sign-up asks for one: with approval on.
 * `createOwnOrg` is the rule on how many may wait at once.
 */
export const createOrg = async (
  _previous: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> => {
  const user = await sessionUser()
  if (!user) return { error: 'Sign in again to create an Org.' }
  if (isDemoUser(user.id)) return { error: DEMO_REFUSAL }

  const name = OrgNameInput.safeParse(formData.get('name'))
  if (!name.success) return { error: ORG_NAME_RULE }

  let plan = null
  if (approvalRequired()) {
    const team = (await marketingTiers()).find((tier) => tier.key === 'team')
    plan = parsePlan(formData, team)
    if (!plan) return { error: 'Choose a plan for the new Org.' }
  }

  let memberId: string
  let orgId: string
  try {
    ;({ memberId, orgId } = await asViewer(user.id, (tx) =>
      createOwnOrg(tx, user.id, { name: name.data, plan }),
    ))
  } catch (error) {
    if (!(error instanceof PendingOrgExists)) throw error
    return {
      error:
        'You already have an Org waiting for approval. You can start another once it is approved.',
    }
  }

  // Ticket 120, reused for ticket 136: the platform admins hear about this
  // Org too, exactly as they would about a sign-up — after the transaction
  // above has committed, and never `throw`ing into it (`notifySignup` never
  // throws). Only when it can be waiting on anybody: off with approval
  // switched off, where nothing is ever pending, and `signupNotice` itself
  // answers nobody once an Org is approved.
  if (approvalRequired()) {
    after(() => notifySignup(user.id, orgId))
  }

  // Lands in the new Org: the waiting page, while it waits.
  const store = await cookies()
  store.set(MEMBER_COOKIE, memberId, MEMBER_COOKIE_OPTIONS)
  redirect('/costs')
  return null
}
