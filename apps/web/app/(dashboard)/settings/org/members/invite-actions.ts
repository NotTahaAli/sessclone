'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { appUrl } from '../../../../../lib/auth/app-url'
import { asViewer } from '../../../../../lib/db'
import {
  invite,
  invitePath,
  revokeInvitation,
  type InvitedRole,
} from '../../../../../lib/invitations'
import { sendInviteEmail, type Delivery } from '../../../../../lib/mailer'
import { orgLogoSrc } from '../../../../../lib/org-logo'
import { setMemberRemoved, setMemberRole } from '../../../../../lib/members'
import {
  currentViewer,
  viewerOfOrg,
  reachesOrgSettings,
  type Role,
} from '../../../../../lib/viewer'
import { DEMO_REFUSAL, isDemoUser } from '../../../../../lib/demo'

// The Members page's writes: ticket 49's invitation and withdrawal, and
// ticket 50's Role change and removal. One file because they are one page's
// writes and share the same two rules — identity from the session, and the Org
// from the session rather than from the form.
//
// A Server Action is a POST endpoint anybody can reach whether or not a form
// was rendered for them, so every field is parsed before it reaches a
// statement.
//
// `invitations_create` and `invitations_revoke` are the rule (an Org the
// caller administers); the Role check here is what turns a refusal into a
// sentence rather than an error boundary.

const Email = z.email().max(254)
const InviteRole: z.ZodType<InvitedRole> = z.enum([
  'admin',
  'manager',
  'member',
])
const Id = z.uuid()
const MemberRole: z.ZodType<Role> = z.enum([
  'owner',
  'admin',
  'manager',
  'member',
])

export type InviteResult =
  | { error: string }
  // The link is shown once, to the person who made it: whoever holds it can
  // join, and it is never stored in a form anybody can read back. `delivery`
  // says whether the email went, so the page can tell the inviter to pass the
  // link on when it did not (ticket 82).
  | { link: string; email: string; delivery: Delivery }
  | null

export const sendInvite = async (
  _previous: unknown,
  formData: FormData,
): Promise<InviteResult> => {
  // The Org the page was rendered for, not whichever the cookie names now: a
  // tab left open across an Org switch must not invite into the other Org.
  const viewer = await viewerOfOrg(formData.get('orgId'))
  if (!viewer || !reachesOrgSettings(viewer.role)) {
    return { error: 'Only an Owner or an Admin may invite someone.' }
  }
  if (isDemoUser(viewer.userId)) return { error: DEMO_REFUSAL }

  const email = Email.safeParse(formData.get('email'))
  const role = InviteRole.safeParse(formData.get('role'))
  if (!email.success) return { error: 'That is not an email address.' }
  if (!role.success) return { error: 'Pick a Role for the invitation.' }

  try {
    const { token, logo } = await asViewer(viewer.userId, async (tx) => ({
      ...(await invite(
        tx,
        viewer.orgId,
        email.data,
        role.data,
        viewer.memberId,
      )),
      // Read in the same transaction as the invitation, so the email carries
      // the logo the Org had when it was sent.
      logo: await orgLogoSrc(tx, viewer.orgId),
    }))
    revalidatePath('/settings/org/members')

    // Deliver it, and report what delivery did. The email and the copyable
    // link carry the same token, so a failed or unconfigured send loses
    // nothing: the inviter passes the link on themselves. Never awaited in a
    // way that can fail the action — `sendInviteEmail` resolves either way.
    const link = invitePath(token)
    const delivery = await sendInviteEmail({
      to: email.data,
      link: `${appUrl()}${link}`,
      orgName: viewer.orgName,
      invitedByEmail: viewer.email,
      logoUrl: logo ? `${appUrl()}${logo}` : null,
    })
    return { link, email: email.data, delivery }
  } catch (error) {
    // The one refusal a person can act on is the live-invitation index: they
    // have already invited this address and the first link is still good.
    const message = error instanceof Error ? error.message : ''
    return {
      error: /duplicate key|unique/i.test(message)
        ? 'That address already has an invitation waiting.'
        : 'That invitation could not be sent.',
    }
  }
}

export const withdrawInvite = async (formData: FormData) => {
  const viewer = await viewerOfOrg(formData.get('orgId'))
  if (!viewer || !reachesOrgSettings(viewer.role)) return

  const id = Id.safeParse(formData.get('invitationId'))
  if (!id.success) return

  await asViewer(viewer.userId, (tx) =>
    revokeInvitation(tx, viewer.orgId, id.data),
  )
  revalidatePath('/settings/org/members')
}

/**
 * Ticket 50: a Role change and a removal, both one column on `members`.
 *
 * Together in this file because they are the same page's writes and the same
 * two checks: identity from the session, the Org never from the form. What
 * they cannot do is decided by the policies, the column guard and the
 * last-Owner trigger; a raise from the last of those is the one refusal worth
 * a sentence of its own, because it is a rule rather than a permission.
 */
export const changeRole = async (
  formData: FormData,
): Promise<{ error: string } | null> => {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) {
    return { error: 'Only an Owner or an Admin may change a Role.' }
  }
  if (isDemoUser(viewer.userId)) return { error: DEMO_REFUSAL }

  const memberId = Id.safeParse(formData.get('memberId'))
  const role = MemberRole.safeParse(formData.get('role'))
  if (!memberId.success || !role.success)
    return { error: 'That is not a Role.' }

  try {
    const changed = await asViewer(viewer.userId, (tx) =>
      setMemberRole(tx, viewer.orgId, memberId.data, role.data),
    )
    if (!changed) return { error: STALE }
  } catch (error) {
    return { error: refusal(error) }
  }

  revalidatePath('/', 'layout')
  return null
}

export const changeMembership = async (
  formData: FormData,
): Promise<{ error: string } | null> => {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) {
    return { error: 'Only an Owner or an Admin may remove a Member.' }
  }
  if (isDemoUser(viewer.userId)) return { error: DEMO_REFUSAL }

  const memberId = Id.safeParse(formData.get('memberId'))
  const to = z.enum(['removed', 'active']).safeParse(formData.get('to'))
  if (!memberId.success || !to.success) return { error: 'Nothing to change.' }

  try {
    const changed = await asViewer(viewer.userId, (tx) =>
      setMemberRemoved(tx, viewer.orgId, memberId.data, to.data === 'removed'),
    )
    if (!changed) return { error: STALE }
  } catch (error) {
    return { error: refusal(error) }
  }

  // Not just this page: a Role decides what the navigation shows, and a
  // removal ends the person's access everywhere.
  revalidatePath('/', 'layout')
  return null
}

/** No row matched: a tab left open across a switch, a change already made,
 * or a person this viewer may not change. None of them is a success. */
const STALE = 'Nothing changed. Reload the page: this list may be out of date.'

/** The last-Owner rule's sentence, or a plain one for anything else. */
const refusal = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  return /at least one owner/i.test(message)
    ? 'An Org keeps at least one Owner. Make somebody else an Owner first.'
    : 'That change could not be made.'
}
