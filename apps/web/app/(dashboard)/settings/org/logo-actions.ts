'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../../lib/db'
import {
  clearOrgLogo,
  LOGO_REFUSALS,
  MAX_LOGO_BYTES,
  readLogo,
  setOrgLogo,
} from '../../../../lib/org-logo'
import { viewerOfOrg } from '../../../../lib/viewer'

// Ticket 77: uploading and removing the Org logo. Owner or Admin, which is
// what `org_logos_set`, `org_logos_replace` and `org_logos_remove` say — a
// Member's attempt writes no rows, which is the criterion's "a Member cannot
// remove it" and is asserted as SQL in `org-logo.test.ts` rather than here.
//
// The bytes arrive in the action rather than through a presigned PUT: the
// migration argues that at length. What matters here is that nothing the
// browser *said* about the file is believed — not its name, not its type, not
// its size. The length is measured and the format is read out of the header.

export type LogoResult = { error: string } | { saved: string } | null

export const uploadOrgLogo = async (
  _previous: unknown,
  formData: FormData,
): Promise<LogoResult> => {
  const viewer = await viewerOfOrg(formData.get('orgId'))
  if (!viewer) return { error: 'Sign in again to change the logo.' }

  const orgId = z.uuid().safeParse(formData.get('orgId'))
  if (!orgId.success) return { error: 'That is not a setting.' }

  const file = formData.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image to upload.' }
  }
  // `size` is the part's real length — this is the server's own parse of the
  // multipart body, not a header the client sent. It is the backstop rather
  // than the first line of defence: Next refuses a Server Action body over
  // 1 MB before this function is called, so `logo-form.tsx` checks the size in
  // the browser to keep the refusal a sentence rather than an error page.
  if (file.size > MAX_LOGO_BYTES) return { error: LOGO_REFUSALS.too_large }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const read = readLogo(bytes)
  if ('refusal' in read) return { error: LOGO_REFUSALS[read.refusal] }

  const written = await asViewer(viewer.userId, (tx) =>
    setOrgLogo(tx, orgId.data, { ...read.logo, bytes }),
  )
  if (!written) {
    return { error: 'You do not have permission to change this setting.' }
  }

  // The layout carries the mark, so the whole shell is what goes stale.
  revalidatePath('/', 'layout')
  return { saved: 'That is the Org’s logo now.' }
}

export const removeOrgLogo = async (
  _previous: unknown,
  formData: FormData,
): Promise<LogoResult> => {
  const viewer = await viewerOfOrg(formData.get('orgId'))
  if (!viewer) return { error: 'Sign in again to change the logo.' }

  const orgId = z.uuid().safeParse(formData.get('orgId'))
  if (!orgId.success) return { error: 'That is not a setting.' }

  const removed = await asViewer(viewer.userId, (tx) =>
    clearOrgLogo(tx, orgId.data),
  )
  // Nothing removed is either a Role that may not or a logo already gone. The
  // form is only rendered when there is one to remove, so the first is the
  // case worth naming.
  if (!removed) {
    return { error: 'You do not have permission to change this setting.' }
  }

  revalidatePath('/', 'layout')
  return { saved: 'The logo is removed. The Org’s initial is shown instead.' }
}
