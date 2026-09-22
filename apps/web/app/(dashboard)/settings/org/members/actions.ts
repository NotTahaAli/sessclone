'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../../../lib/db'
import { setScope } from '../../../../../lib/scopes'
import { currentViewer, reachesOrgSettings } from '../../../../../lib/viewer'

// Ticket 46's write. A Server Action is a POST endpoint anybody can reach,
// whether or not the page rendered a form for them, so identity comes from the
// session and every input is parsed before it reaches a statement.
//
// The policies are what decide who may assign a Scope: `member_scopes_assign`
// and `member_scopes_revoke` are "an Org this caller administers", and the
// composite foreign keys refuse a Manager or a Member from another Org even
// when the Org id is one the caller really does administer. This action runs
// on the viewer's connection, so both apply.
//
// The Role is still checked here, because the two refusals are not symmetric:
// a refused insert raises out of the action and into an error boundary, while
// a refused delete quietly removes nothing and looks like a success. Checking
// first is what makes both cases one answer. The policy remains the backstop,
// never the only check.
//
// The Org is the viewer's own, read from the session rather than from the
// form. The policies make a forged id harmless, but an input that cannot be
// forged is better than one that is caught.

const Id = z.uuid()
const On = z.enum(['on', 'off'])

export const setScopeMember = async (formData: FormData) => {
  const viewer = await currentViewer()
  if (!viewer || !reachesOrgSettings(viewer.role)) return

  const managerMemberId = Id.safeParse(formData.get('managerMemberId'))
  const memberId = Id.safeParse(formData.get('memberId'))
  const to = On.safeParse(formData.get('to'))
  if (!managerMemberId.success || !memberId.success || !to.success) return

  await asViewer(viewer.userId, (tx) =>
    setScope(
      tx,
      viewer.orgId,
      managerMemberId.data,
      memberId.data,
      to.data === 'on',
    ),
  )

  revalidatePath('/settings/org/members')
}
