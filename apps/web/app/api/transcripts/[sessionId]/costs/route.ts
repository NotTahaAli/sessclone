import { z } from 'zod'

import { memberOrgLocked } from '../../../../../lib/approval'
import { asViewer } from '../../../../../lib/db'
import { sessionUser } from '../../../../../lib/supabase/server'
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
  const user = await sessionUser()
  if (!user) return new Response('sign in first', { status: 401 })

  const sessionId = SessionId.safeParse((await params).sessionId)
  const member = Member.safeParse(
    new URL(request.url).searchParams.get('member'),
  )
  if (!sessionId.success || !member.success) {
    return new Response('no such session', { status: 404 })
  }

  // Ticket 119: the lock of the Org that owns these Turns, not the viewer's.
  const costs = await asViewer(user.id, async (tx) =>
    (await memberOrgLocked(tx, member.data))
      ? null
      : sessionTurnCosts(tx, member.data, sessionId.data),
  )
  if (!costs) {
    return new Response('this Org is waiting for approval', { status: 403 })
  }
  return Response.json(costs, { headers: { 'cache-control': 'no-store' } })
}
