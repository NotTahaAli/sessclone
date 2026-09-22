'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  setArchivalEnabled,
  setProjectArchival,
} from '../../../../lib/archival'
import { NAME_LIMIT, setDisplayName } from '../../../../lib/names'
import type { NameState } from '../../inline-name'
import { asViewer } from '../../../../lib/db'
import { signedInUser } from '../../../../lib/supabase/server'

// Ticket 72's two writes. A Server Action is a POST endpoint anybody can
// reach, whether or not the page rendered a form for them, so identity comes
// from the session here and every input is parsed before it reaches a
// statement — the same treatment `app/keys/actions.ts` gives its inputs, for
// the same two reasons (Next's own guidance, and this repo's rule about
// validating at trust boundaries with zod).
//
// Neither action decides whose settings these are. `lib/archival.ts`
// intersects the membership with `sessclone_own_member_ids()`, and the
// policies and the column guard refuse behind that (ADR 0001, ADR 0005).

const Id = z.uuid()
const On = z.enum(['on', 'off'])
const Name = z.string().trim().max(NAME_LIMIT)

const parse = (formData: FormData) => {
  const memberId = Id.safeParse(formData.get('memberId'))
  const to = On.safeParse(formData.get('to'))
  if (!memberId.success || !to.success) return null
  return { memberId: memberId.data, enabled: to.data === 'on' }
}

/**
 * The master switch, for one of the viewer's memberships.
 *
 * Off is forward-only: it stops new uploads and leaves what is already stored,
 * which is ADR 0005 and what the page says out loud. Deleting stored
 * transcripts is ticket 73's separate, explicit action.
 */
export const setArchival = async (formData: FormData) => {
  const user = await signedInUser()
  if (!user) return

  const input = parse(formData)
  if (!input) return

  await asViewer(user.id, (tx) =>
    setArchivalEnabled(tx, input.memberId, input.enabled),
  )

  revalidatePath('/settings/you')
}

/** Excludes or re-includes one Project within that membership's switch. */
export const setProject = async (formData: FormData) => {
  const user = await signedInUser()
  if (!user) return

  const input = parse(formData)
  const projectId = Id.safeParse(formData.get('projectId'))
  if (!input || !projectId.success) return

  await asViewer(user.id, (tx) =>
    setProjectArchival(tx, input.memberId, projectId.data, input.enabled),
  )

  revalidatePath('/settings/you')
}

/**
 * Ticket 91: the name this person is called, instead of their address.
 *
 * Whose name it is is `users_write_self` and not this file: the statement
 * names the signed-in user and nobody else's row can match. An empty box is
 * "no name", which is null rather than `''` — every surface falls back to the
 * address on null, and the check constraint refuses a blank besides.
 */
export const setName = async (
  _previous: NameState,
  formData: FormData,
): Promise<NameState> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to set your name.' }

  const name = Name.safeParse(formData.get('name'))
  if (!name.success) {
    return {
      error:
        typeof formData.get('name') === 'string'
          ? `A name is ${NAME_LIMIT} characters or fewer.`
          : 'That request was missing the name.',
    }
  }

  const value = name.data === '' ? null : name.data
  const written = await asViewer(user.id, (tx) =>
    setDisplayName(tx, user.id, value),
  )
  if (!written) return { error: 'That name could not be saved.' }

  // Your name is the label on every surface that used to print your address,
  // most of which are other routes.
  revalidatePath('/', 'layout')
  return { saved: value }
}
