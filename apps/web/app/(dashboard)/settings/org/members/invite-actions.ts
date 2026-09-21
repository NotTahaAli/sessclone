'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../../../lib/db'
import {
  invite,
  invitePath,
  revokeInvitation,
  type InvitedRole,
} from '../../../../../lib/invitations'
import { setMemberRemoved, setMemberRole } from '../../../../../lib/members'
import {
  currentViewer,
  reachesOrgSettings,
  type Role,
} from '../../../../../lib/viewer'

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
  // join, and it is never stored in a form anybody can read back.
  | { link: string; email: string }
  | null

export const sendInvite = async (
  _previous: unknown,
  formData: FormData,
): Promise<InviteResult> => {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) {
    return { error: 'Only an Owner or an Admin may invite someone.' }
  }

  const email = Email.safeParse(formData.get('email'))
  const role = InviteRole.safeParse(formData.get('role'))
  if (!email.success) return { error: 'That is not an email address.' }
  if (!role.success) return { error: 'Pick a Role for the invitation.' }

  try {
    const { token } = await asViewer(viewer.userId, (tx) =>
      invite(tx, viewer.orgId, email.data, role.data, viewer.memberId),
    )
    revalidatePath('/settings/org/members')
    return { link: invitePath(token), email: email.data }
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
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) return

  const id = Id.safeParse(formData.get('invitationId'))
  if (!id.success) return

  await asViewer(viewer.userId, (tx) => revokeInvitation(tx, id.data))
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

  const memberId = Id.safeParse(formData.get('memberId'))
  const role = MemberRole.safeParse(formData.get('role'))
  if (!memberId.success || !role.success)
    return { error: 'That is not a Role.' }

  try {
    await asViewer(viewer.userId, (tx) =>
      setMemberRole(tx, memberId.data, role.data),
    )
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

  const memberId = Id.safeParse(formData.get('memberId'))
  const to = z.enum(['removed', 'active']).safeParse(formData.get('to'))
  if (!memberId.success || !to.success) return { error: 'Nothing to change.' }

  try {
    await asViewer(viewer.userId, (tx) =>
      setMemberRemoved(tx, memberId.data, to.data === 'removed'),
    )
  } catch (error) {
    return { error: refusal(error) }
  }

  // Not just this page: a Role decides what the navigation shows, and a
  // removal ends the person's access everywhere.
  revalidatePath('/', 'layout')
  return null
}

/** The last-Owner rule's sentence, or a plain one for anything else. */
const refusal = (error: unknown) => {
  const message = error instanceof Error ? error.message : ''
  return /at least one owner/i.test(message)
    ? 'An Org keeps at least one Owner. Make somebody else an Owner first.'
    : 'That change could not be made.'
}
