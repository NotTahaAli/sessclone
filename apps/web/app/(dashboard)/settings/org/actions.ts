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

export const setTimezone = async (formData: FormData) => {
  const user = await signedInUser()
  if (!user) return

  const timezone = Timezone.safeParse(formData.get('timezone'))
  const orgId = z.uuid().safeParse(formData.get('orgId'))
  if (!timezone.success || !orgId.success) return

  await asViewer(user.id, (tx) => setOrgTimezone(tx, orgId.data, timezone.data))

  revalidatePath('/settings/org')
}
