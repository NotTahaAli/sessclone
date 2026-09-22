'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import type { NameState } from '../../inline-name'
import { asViewer } from '../../../../lib/db'
import { labelSession, NAME_LIMIT } from '../../../../lib/names'
import { currentViewer } from '../../../../lib/viewer'

// Ticket 90's second write: a name for a Session.
//
// The Org comes from the viewer's membership rather than from the form —
// `session_labels` carries it so a label cannot be filed against an Org the
// Member does not belong to, and a value posted by the browser would be
// exactly the thing that claim is meant to prevent. The composite foreign key
// refuses a mismatch behind that.
//
// Who may write it is `session_labels_write`: the Session's own Member, or an
// Owner or Admin of its Org. A refusal writes nothing and raises nothing, so
// the sentence below is how the reader learns which happened.

const MemberId = z.uuid()
const SessionId = z.string().min(1).max(200)
const Name = z.string().trim().max(NAME_LIMIT)

export const labelSessionAction = async (
  _previous: NameState,
  formData: FormData,
): Promise<NameState> => {
  const viewer = await currentViewer()
  if (!viewer) return { error: 'Sign in again to name this Session.' }

  const memberId = MemberId.safeParse(formData.get('memberId'))
  const sessionId = SessionId.safeParse(formData.get('sessionId'))
  const name = Name.safeParse(formData.get('name'))
  if (!memberId.success || !sessionId.success) {
    return { error: 'That is not a Session.' }
  }
  if (!name.success) {
    return {
      error:
        typeof formData.get('name') === 'string'
          ? `A name is ${NAME_LIMIT} characters or fewer.`
          : 'That request was missing the name.',
    }
  }

  const value = name.data === '' ? null : name.data

  // An insert refused by a policy *raises* where an update merely matches no
  // row, so this one write has to catch as well as check its result. The catch
  // is outside the transaction, so the refusal rolls back rather than leaving
  // an aborted transaction to be committed.
  const written = await asViewer(viewer.userId, (tx) =>
    labelSession(tx, viewer.orgId, memberId.data, sessionId.data, value),
  ).catch(() => false)

  if (!written) {
    return { error: 'That Session is not yours to name.' }
  }

  // The name is the row's label in the Sessions list as well as the title
  // here, and that list is another route.
  revalidatePath('/', 'layout')
  return { saved: value }
}
