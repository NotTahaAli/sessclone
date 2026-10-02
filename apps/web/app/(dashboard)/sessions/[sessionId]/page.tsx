import { notFound, redirect } from 'next/navigation'

import { sessionDetailView, UUID } from './detail'
import { currentViewer } from '../../../../lib/viewer'

// Ticket 86's second half: one Session, and what ran inside it. The detail is
// `detail.tsx`, which since ticket 112 also draws the Finder column beside the
// Sessions list on desktop; this is its page, for a phone and a sent link.

export default async function Session({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>
  searchParams: Promise<{ member?: string; after?: string }>
}) {
  const viewer = await currentViewer()
  if (!viewer) return null

  const { sessionId } = await params
  const { member, after } = await searchParams

  // No member: the viewer's own Session in the active Org. That is the link
  // the Collector's status bar opens, which knows the Session but not who the
  // dashboard calls its person; the redirect keeps one address per page.
  if (member === undefined) {
    const query = new URLSearchParams({ member: viewer.memberId })
    if (after) query.set('after', after)
    redirect(`/sessions/${sessionId}?${query}`)
  }

  // A member id is a uuid and the statements compare it as one, so anything
  // else would be a cast error rather than an empty result. Refuse it here: a
  // hand-typed URL is a 404, not a 500.
  if (!UUID.test(member)) notFound()

  const detail = await sessionDetailView({
    viewer,
    member,
    sessionId: decodeURIComponent(sessionId),
    after,
  })
  if (!detail) notFound()

  return <div className="max-w-3xl">{detail}</div>
}
