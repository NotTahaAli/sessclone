import { NextResponse, type NextRequest } from 'next/server'

import { DEMO_COOKIE, DEMO_COOKIE_OPTIONS, demoEnabled } from '../../lib/demo'

// Ticket 137: "Try the demo". Sets the cookie that makes a visitor with no
// session the demo visitor (`sessionUser`), then opens Costs. A 404 unless
// the deployment runs the demo. Linked with a plain anchor, never prefetched.

export function GET(request: NextRequest) {
  if (!demoEnabled()) return new Response('Not found', { status: 404 })

  const costs = request.nextUrl.clone()
  costs.pathname = '/costs'
  costs.search = ''
  const response = NextResponse.redirect(costs)
  response.cookies.set(DEMO_COOKIE, '1', DEMO_COOKIE_OPTIONS)
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}
