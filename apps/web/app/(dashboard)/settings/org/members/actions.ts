'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../../../lib/db'
import { setScope } from '../../../../../lib/scopes'
import { signedInUser } from '../../../../../lib/supabase/server'

// Ticket 46's write. A Server Action is a POST endpoint anybody can reach,
// whether or not the page rendered a form for them, so identity comes from the
// session and every input is parsed before it reaches a statement.
//
// Nothing here decides who may assign a Scope. `member_scopes_assign` and
// `member_scopes_revoke` are "an Org this caller administers", and the
// composite foreign keys refuse a Manager or a Member from another Org even
// when the Org id is one the caller really does administer. This action runs
// on the viewer's connection, so both apply, and a refusal is a write that
// touched no rows.

const Id = z.uuid()
const On = z.enum(['on', 'off'])

export const setScopeMember = async (formData: FormData) => {
  const user = await signedInUser()
  if (!user) return

  const orgId = Id.safeParse(formData.get('orgId'))
  const managerMemberId = Id.safeParse(formData.get('managerMemberId'))
  const memberId = Id.safeParse(formData.get('memberId'))
  const to = On.safeParse(formData.get('to'))
  if (
    !orgId.success ||
    !managerMemberId.success ||
    !memberId.success ||
    !to.success
  ) {
    return
  }

  await asViewer(user.id, (tx) =>
    setScope(
      tx,
      orgId.data,
      managerMemberId.data,
      memberId.data,
      to.data === 'on',
    ),
  )

  revalidatePath('/settings/org/members')
}
