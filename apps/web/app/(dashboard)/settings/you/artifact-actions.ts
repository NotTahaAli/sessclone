'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import {
  deleteStoredProject,
  deleteStoredSession,
} from '../../../../lib/artifacts'
import { asViewer } from '../../../../lib/db'
import { signedInUser } from '../../../../lib/supabase/server'

// Ticket 73's two writes, beside ticket 72's. A Server Action is a POST
// endpoint anybody can reach whether or not the page rendered a form for them,
// so identity comes from the session and every input is parsed before it
// reaches a statement.
//
// Neither action decides whose transcripts these are. `lib/artifacts.ts`
// intersects with `sessclone_own_member_ids()` and `log_artifacts_delete`
// refuses behind that — narrower than the read policy beside it, so an Owner
// who may download a Member's transcript still may not destroy it.

const Id = z.uuid()

/** Destroys one Session's transcript: the row and the object together. */
export const deleteSession = async (formData: FormData) => {
  const user = await signedInUser()
  if (!user) return

  const artifactId = Id.safeParse(formData.get('artifactId'))
  if (!artifactId.success) return

  // The outcome is deliberately not reported. The page renders the viewer's
  // own rows and nothing else, so a refusal here is a hand-assembled post,
  // and an answer that told it apart from "already gone" would say whether an
  // artifact id belongs to somebody.
  await asViewer(user.id, (tx) => deleteStoredSession(tx, artifactId.data))

  revalidatePath('/settings/you')
}

/**
 * Destroys every transcript of one Project of one membership.
 *
 * `projectId` is absent for the Sessions that ran outside any repository, and
 * absent is a real group rather than a missing value — an empty string would
 * be indistinguishable from a form that forgot the field, so the form names
 * the group instead.
 */
export const deleteProject = async (formData: FormData) => {
  const user = await signedInUser()
  if (!user) return

  const memberId = Id.safeParse(formData.get('memberId'))
  const raw = formData.get('projectId')
  const project = raw === 'none' ? null : Id.safeParse(raw)
  if (!memberId.success || project?.success === false) return

  await asViewer(user.id, (tx) =>
    deleteStoredProject(tx, memberId.data, project ? project.data : null),
  )

  revalidatePath('/settings/you')
}
