'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  cancelOwnDeletion,
  requestOwnDeletion,
  signInIsFresh,
} from '../../../../lib/account-deletion'
import { asViewer } from '../../../../lib/db'
import { DEMO_REFUSAL, isDemoUser } from '../../../../lib/demo'
import {
  sessionClaims,
  sessionUser,
  signedInUser,
  supabaseServer,
} from '../../../../lib/supabase/server'
import { signOut } from '../../../sign-in/actions'

// Ticket 141: asking for your account to be deleted, and taking it back.
//
// Asking is refused unless the typed address is the account's own and the
// sign-in is under ten minutes old; the last-Owner rule is the database's
// (`sessclone_request_account_deletion`). A request signs the person out at
// once, which is what "frozen" looks like from their side.

export type DeletionState = {
  error?: string
  /** The sign-in is too old: offer "Sign in again" rather than an error. */
  stale?: true
} | null

const Confirm = z.string().trim().toLowerCase().max(320)

export const requestAccountDeletion = async (
  _previous: DeletionState,
  formData: FormData,
): Promise<DeletionState> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in first.' }
  if (isDemoUser(user.id)) return { error: DEMO_REFUSAL }

  const typed = Confirm.safeParse(formData.get('email'))
  if (!typed.success || typed.data !== user.email.toLowerCase()) {
    return { error: 'Type your email address exactly as shown.' }
  }

  const claims = await sessionClaims()
  if (!claims || !signInIsFresh(claims)) return { stale: true }

  try {
    await asViewer(user.id, requestOwnDeletion)
  } catch (error) {
    if (
      error instanceof Error &&
      /hand over ownership first/.test(error.message)
    ) {
      return {
        error:
          'You are the only Owner of an Org with other people in it. Make one of them an Owner first.',
      }
    }
    throw error
  }

  return signOut()
}

/** Signs out and back in, landing here again, for a stale sign-in. */
export const signInAgain = async () => {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  redirect('/sign-in?next=/settings/you')
}

/** Keep my account: the whole request undone. Works during the grace,
 * which is why it asks `sessionUser` and not `signedInUser`. */
export const keepAccount = async () => {
  const user = await sessionUser()
  if (!user || isDemoUser(user.id)) redirect('/sign-in')
  await asViewer(user.id, cancelOwnDeletion)
  redirect('/')
}
