import { z } from 'zod'

import { asViewer } from '../../../../../lib/db'
import { signedInUser } from '../../../../../lib/supabase/server'
import { sessionTurnCosts } from '../../../../../lib/transcript-files'

// Tickets 105-107: the priced Turns of one Session, keyed
// `<agentId or ''>:<messageId>` (see `costKey`), for the viewer to annotate
// assistant messages. `turns_read` decides which Turns come back; a Session
// the viewer cannot see is an empty object, which says no more than a 404.

const SessionId = z.string().min(1).max(200)

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await signedInUser()
  if (!user) return new Response('sign in first', { status: 401 })

  const sessionId = SessionId.safeParse((await params).sessionId)
  if (!sessionId.success) {
    return new Response('no such session', { status: 404 })
  }

  const costs = await asViewer(user.id, (tx) =>
    sessionTurnCosts(tx, sessionId.data),
  )
  return Response.json(costs, { headers: { 'cache-control': 'no-store' } })
}
