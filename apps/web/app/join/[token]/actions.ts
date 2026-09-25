'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { asViewer } from '../../../lib/db'
import { acceptFailure, acceptInvitation } from '../../../lib/invitations'
import { sessionUser } from '../../../lib/supabase/server'

// Accepting is a write, so it is a POST and never the render of a GET.
//
// As a GET it was reachable by anything that replays a URL with the visitor's
// cookie — a prefetch, a link unfurler, a corporate URL scanner — and by any
// page that could make the victim's browser fetch it. That would spend the
// invitation, or enrol somebody into an Org they never chose to join.

const Token = z.string().min(1).max(200)

export const acceptAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | null> => {
  const user = await sessionUser()
  if (!user) return { error: 'Sign in to accept this invitation.' }

  const token = Token.safeParse(formData.get('token'))
  if (!token.success) return { error: 'This invitation is not valid.' }

  try {
    await asViewer(user.id, (tx) =>
      acceptInvitation(tx, token.data, user.email),
    )
  } catch (error) {
    // Outside the transaction: a raise aborts it, so the error surfaces again
    // when the transaction ends however the statement was wrapped.
    return { error: acceptFailure(error) }
  }

  // Where a new Member starts. Outside the `try` on purpose — `redirect`
  // throws by design, and catching it would report a join as a refusal. The
  // `return` is unreachable, and is what says the function always answers.
  redirect('/costs')
  return null
}
