'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../../lib/db'
import { setOrgTimezone } from '../../../../lib/org'
import { signedInUser } from '../../../../lib/supabase/server'

// Ticket 51's one write. A Server Action is a POST endpoint anybody can reach,
// whether or not the page rendered a form for them, so identity comes from the
// session and every input is parsed before it reaches a statement — the same
// treatment the Keys and Your-settings actions give theirs.
//
// Nothing here decides who may write: `orgs_write` is Owner or Admin, and the
// trigger beside the column refuses a name the timezone database does not
// know. The action runs on the viewer's connection, so both apply, and a
// refusal is a write that touched no rows rather than an error to render.

// A zone name, bounded and shaped before it reaches the statement. The real
// check is the trigger's — this is the trust boundary doing its own job, not
// a second copy of the timezone database.
const Timezone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_-]+)*$/)

export const setTimezone = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { saved: string } | null> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to change the timezone.' }

  const timezone = Timezone.safeParse(formData.get('timezone'))
  const orgId = z.uuid().safeParse(formData.get('orgId'))
  if (!timezone.success || !orgId.success) {
    return { error: 'That is not a timezone this deployment knows.' }
  }

  try {
    const written = await asViewer(user.id, (tx) =>
      setOrgTimezone(tx, orgId.data, timezone.data),
    )
    // A write refused by `orgs_write` touches no rows and raises nothing, so
    // without this a Manager posting the form gets a page that looks like it
    // saved. Told apart from the raise below because they need different
    // sentences: one is "you may not", the other is "that name is not one".
    if (!written) {
      return { error: 'You do not have permission to change this setting.' }
    }
  } catch {
    // The trigger refuses a name the timezone database does not know, and one
    // that is a fixed offset wearing a name. Either way the Owner needs the
    // sentence rather than an error page.
    return { error: 'That is not a timezone this deployment knows.' }
  }

  // Not just this page: `viewer.orgTimezone` is read by the shell and by every
  // surface that cuts Turns into days, and those live on other routes. A
  // revalidation of this path alone would leave the charts on the old zone
  // until something else happened to evict them.
  revalidatePath('/', 'layout')
  return { saved: timezone.data }
}
