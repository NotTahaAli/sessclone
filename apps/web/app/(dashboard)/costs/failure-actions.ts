'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../lib/db'
import { markFailuresViewed } from '../../../lib/failures'
import { resolveRange } from '../../../lib/range'
import { currentViewer } from '../../../lib/viewer'

// Taha, 2026-09-23: "allow to mark failed as Viewed". One Session, or every
// failed Session in the period the list is showing. Per viewer: the mark is
// the signed-in person's own, and `failure_views_own_insert` refuses anything
// else independently of this parse (ADR 0001). A Server Action is a POST
// endpoint whether or not a form was rendered, so every field is parsed.

const Form = z.object({
  // The period exactly as the page's URL carries it; `resolveRange` turns
  // anything it cannot read into the default rather than failing.
  range: z.string().max(40).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  // Both or neither: neither is "mark all".
  memberId: z.uuid().optional(),
  sessionId: z.string().trim().min(1).max(200).optional(),
  // When the page was read: the mark covers what was on screen, not a failure
  // received since. `markFailuresViewed` clamps it to now(). The regex passes
  // a month 13; the coerce refuses the Invalid Date it makes.
  seenAt: z.iso.datetime().pipe(z.coerce.date()),
})

const field = (data: FormData, key: string) => {
  const value = data.get(key)
  return typeof value === 'string' && value !== '' ? value : undefined
}

export const markFailuresViewedAction = async (
  formData: FormData,
): Promise<void> => {
  const viewer = await currentViewer()
  if (!viewer) return

  const parsed = Form.safeParse({
    range: field(formData, 'range'),
    from: field(formData, 'from'),
    to: field(formData, 'to'),
    memberId: field(formData, 'memberId'),
    sessionId: field(formData, 'sessionId'),
    seenAt: field(formData, 'seenAt'),
  })
  if (!parsed.success) return
  const { memberId, sessionId, seenAt, ...period } = parsed.data
  if ((memberId === undefined) !== (sessionId === undefined)) return

  await asViewer(viewer.userId, (tx) =>
    markFailuresViewed(tx, {
      orgId: viewer.orgId,
      viewerMemberId: viewer.memberId,
      timezone: viewer.orgTimezone,
      range: resolveRange(period, viewer.orgTimezone).range,
      session: memberId && sessionId ? { memberId, sessionId } : undefined,
      seenAt,
    }),
  )

  revalidatePath('/costs')
}
