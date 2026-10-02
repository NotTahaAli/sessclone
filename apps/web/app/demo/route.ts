import { NextResponse } from 'next/server'

import { DEMO_COOKIE, DEMO_COOKIE_OPTIONS, demoEnabled } from '../../lib/demo'

// Ticket 137: "Try the demo". Sets the cookie that makes a visitor with no
// session the demo visitor (`sessionUser`), then opens Costs. A 404 unless
// the deployment runs the demo. Linked with a plain anchor, never prefetched.
//
// Costs opens on the last 30 days, not the default calendar month: the demo
// seeds a day only once it has ended, so on the 1st "this month" is empty and
// the visitor's first screen would read "Nothing in this period". Every
// other demo page defaults to the same period (`defaultPreset`, `lib/range.ts`).

export function GET() {
  if (!demoEnabled()) return new Response('Not found', { status: 404 })

  // A relative Location (RFC 9110 allows it), so the browser stays on the
  // host it asked, where the cookie was set. `request.nextUrl` names the
  // server's own host behind a proxy or `next start` (`localhost`), and a
  // redirect there lands without the cookie, on the sign-in page.
  const response = new NextResponse(null, {
    status: 307,
    headers: { location: '/costs?range=last-30' },
  })
  response.cookies.set(DEMO_COOKIE, '1', DEMO_COOKIE_OPTIONS)
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  return response
}
