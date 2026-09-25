'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createApiKey, revokeApiKey } from '../../../lib/api-keys'
import { asViewer } from '../../../lib/db'
import { signedInUser } from '../../../lib/supabase/server'
import { currentViewer } from '../../../lib/viewer'

// A Server Action is a POST endpoint that anyone can reach, whether or not the
// page rendered a form for them — so identity is taken from the session here
// and the inputs are parsed before either reaches a statement. Both are the
// Next security guidance (`node_modules/next/dist/docs/01-app/02-guides/
// server-actions.md`, "Framework protections are not a substitute for
// application-level checks"), and the repo's own rule about validating at
// trust boundaries with zod.

const Label = z.string().trim().min(1).max(80)
const Id = z.uuid()

/**
 * The one moment the key exists outside the collector's config.
 *
 * It comes back as this action's return value and is put on the screen by
 * `useActionState` for that render alone. It is not redirected to in a query
 * string, not put in a cookie and not written anywhere — so a reload of
 * `/keys` shows the list without it, which is ticket 28's "shown once".
 */
export const createKey = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ key: string } | { error: string } | null> => {
  const viewer = await currentViewer()
  if (!viewer) return { error: 'Sign in again to create a key.' }

  const label = Label.safeParse(formData.get('label'))
  if (!label.success) {
    return { error: 'Give the key a label — the machine it will live on.' }
  }

  try {
    // The current Org's membership, never a form field: the key reports
    // where the person is looking, and the switcher is how they change that.
    const key = await asViewer(viewer.userId, (tx) =>
      createApiKey(tx, label.data, viewer.memberId),
    )
    revalidatePath('/keys')
    return { key }
  } catch {
    // The message would say which membership was refused, which is a fact
    // about somebody else's Org if the id was guessed at.
    return { error: 'Could not create that key. Try again.' }
  }
}

/** Revokes one key. Immediate, and only that key. */
export const revokeKey = async (formData: FormData) => {
  const user = await signedInUser()
  if (!user) return

  const id = Id.safeParse(formData.get('id'))
  if (!id.success) return

  // No ownership check beside this one: `api_keys_own` refuses a key that is
  // not the viewer's, and the statement updates nothing.
  await asViewer(user.id, (tx) => revokeApiKey(tx, id.data))

  revalidatePath('/keys')
}
