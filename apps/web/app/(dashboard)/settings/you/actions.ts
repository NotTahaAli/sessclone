'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  setArchivalEnabled,
  setProjectArchival,
} from '../../../../lib/archival'
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
