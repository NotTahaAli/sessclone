import { z } from 'zod'

import { asViewer } from '../../../../../lib/db'
import { signedInUser } from '../../../../../lib/supabase/server'
import { viewerLocked } from '../../../../../lib/viewer'
import { sessionTurnCosts } from '../../../../../lib/transcript-files'

// Tickets 105-107: the priced Turns of one Session, keyed
// `<agentId or ''>:<messageId>` (see `costKey`), for the viewer to annotate
// assistant messages. `turns_read` decides which Turns come back; a Session
// the viewer cannot see is an empty object, which says no more than a 404.

const SessionId = z.string().min(1).max(200)
/** Session ids are unique per Member, so the Member is part of the name. */
const Member = z.uuid()

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await signedInUser()
  if (!user) return new Response('sign in first', { status: 401 })
  // Ticket 119: a locked Org is refused here as its pages are.
  if (await viewerLocked()) {
    return new Response('this Org is waiting for approval', { status: 403 })
  }

  const sessionId = SessionId.safeParse((await params).sessionId)
  const member = Member.safeParse(
    new URL(request.url).searchParams.get('member'),
  )
  if (!sessionId.success || !member.success) {
    return new Response('no such session', { status: 404 })
  }

  const costs = await asViewer(user.id, (tx) =>
    sessionTurnCosts(tx, member.data, sessionId.data),
  )
  return Response.json(costs, { headers: { 'cache-control': 'no-store' } })
}
