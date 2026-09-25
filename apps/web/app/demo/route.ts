import { NextResponse } from 'next/server'

import { DEMO_COOKIE, DEMO_COOKIE_OPTIONS, demoEnabled } from '../../lib/demo'

// Ticket 137: "Try the demo". Sets the cookie that makes a visitor with no
// session the demo visitor (`sessionUser`), then opens Costs. A 404 unless
// the deployment runs the demo. Linked with a plain anchor, never prefetched.

export function GET() {
  if (!demoEnabled()) return new Response('Not found', { status: 404 })

  // A relative Location (RFC 9110 allows it), so the browser stays on the
  // host it asked, where the cookie was set. `request.nextUrl` names the
  // server's own host behind a proxy or `next start` (`localhost`), and a
  // redirect there lands without the cookie, on the sign-in page.
  const response = new NextResponse(null, {
    status: 307,
    headers: { location: '/costs' },
  })
  response.cookies.set(DEMO_COOKIE, '1', DEMO_COOKIE_OPTIONS)
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}
