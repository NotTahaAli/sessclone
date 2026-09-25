'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import type { NameState } from '../../../inline-name'
import { asViewer } from '../../../../../lib/db'
import { NAME_LIMIT, renameProject } from '../../../../../lib/names'
import { signedInUser } from '../../../../../lib/supabase/server'
import { DEMO_REFUSAL, isDemoUser } from '../../../../../lib/demo'

// Ticket 90's first write. A Server Action is a POST anybody can reach whether
// or not a form was rendered for them, so the Project id is parsed and
// identity comes from the session rather than from the request.
//
// Who may name a Project is `projects_rename` — Owner or Admin — and not this
// file. A rename by anybody else matches no row and writes nothing, which is
// why the action reports a refusal rather than assuming a hit.

const ProjectId = z.uuid()
const Name = z.string().trim().max(NAME_LIMIT)

export const renameProjectAction = async (
  _previous: NameState,
  formData: FormData,
): Promise<NameState> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to name this Project.' }
  if (isDemoUser(user.id)) return { error: DEMO_REFUSAL }

  const projectId = ProjectId.safeParse(formData.get('projectId'))
  const name = Name.safeParse(formData.get('name'))
  if (!projectId.success) return { error: 'That is not a Project.' }
  if (!name.success) {
    return {
      error:
        typeof formData.get('name') === 'string'
          ? `A name is ${NAME_LIMIT} characters or fewer.`
          : 'That request was missing the name.',
    }
  }

  // An empty box is "no name", not a Project called "". The column is null
  // when unnamed and every surface falls back to the key, so clearing has to
  // write null or the lists show a blank where a key should be.
  const value = name.data === '' ? null : name.data

  const written = await asViewer(user.id, (tx) =>
    renameProject(tx, projectId.data, value),
  )
  if (!written) {
    return { error: 'Naming a Project is an Owner’s or an Admin’s to do.' }
  }

  // Not just this page: the name is the label in the Costs breakdown, in the
  // Sessions list and on every Turn row, which are other routes.
  revalidatePath('/', 'layout')
  return { saved: value }
}
