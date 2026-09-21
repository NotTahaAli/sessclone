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
import { currentViewer, reachesOrgSettings } from '../../../../../lib/viewer'

// Ticket 49's two writes. A Server Action is a POST endpoint anybody can
// reach, so identity comes from the session, the Org comes from the session
// too, and every field is parsed before it reaches a statement.
//
// `invitations_create` and `invitations_revoke` are the rule (an Org the
// caller administers); the Role check here is what turns a refusal into a
// sentence rather than an error boundary.

const Email = z.email().max(254)
const Role: z.ZodType<InvitedRole> = z.enum(['admin', 'manager', 'member'])
const Id = z.uuid()

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
  const role = Role.safeParse(formData.get('role'))
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
