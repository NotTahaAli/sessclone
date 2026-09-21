'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../lib/db'
import { renameDevice } from '../../../lib/devices'
import { signedInUser } from '../../../lib/supabase/server'

// Ticket 57's one write. A Server Action is a POST anybody can reach whether
// or not a form was rendered for them, so the Device id is parsed and identity
// comes from the session rather than from the request.
//
// Whose Device it is is `devices_rename`, not this file: a rename of somebody
// else's machine matches no row and writes nothing, which is why the action
// reports a refusal rather than assuming a hit.

const Nickname = z.string().trim().max(60)
const DeviceId = z.uuid()

export const rename = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { saved: string | null } | null> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to rename this machine.' }

  const deviceId = DeviceId.safeParse(formData.get('deviceId'))
  const nickname = Nickname.safeParse(formData.get('nickname'))
  if (!deviceId.success) return { error: 'That machine is not one of yours.' }
  if (!nickname.success) {
    // A name that is too long is the only way a rendered form reaches this;
    // a missing field is a malformed post, and says so rather than blaming
    // the length of something that was never sent.
    return {
      error:
        typeof formData.get('nickname') === 'string'
          ? 'A name is 60 characters or fewer.'
          : 'That request was missing the name.',
    }
  }

  // An empty box is "no nickname", not a Device called "". The column is null
  // when unnamed and every surface falls back to the key on null, so clearing
  // has to write null or the list shows a blank label.
  const value = nickname.data === '' ? null : nickname.data

  const written = await asViewer(user.id, (tx) =>
    renameDevice(tx, deviceId.data, value),
  )
  if (!written) return { error: 'That machine is not one of yours.' }

  // Not just this page: the name is the label in the Costs breakdown by Device
  // (ticket 56), which is on another route.
  revalidatePath('/', 'layout')
  return { saved: value }
}
