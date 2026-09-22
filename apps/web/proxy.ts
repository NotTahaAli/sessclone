import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { safeNext } from './lib/auth/next-path'

// Next 16 calls this Proxy; it is what earlier versions called Middleware.
// Two jobs, and no more than two: refresh the Supabase session on every
// request, and send a signed-out visitor to the sign-in page.
//
// It is not the authorisation layer. Next's own documentation is explicit that
// Proxy is for optimistic checks rather than session management or
// authorisation, and in this app authorisation lives in row-level security
// (ADR 0001) — a page that forgot this file would show an empty dashboard, not
// somebody else's data.
//
// The session refresh is the part that cannot move. Server Components cannot
// write cookies, so a rotated refresh token has nowhere to land unless
// something ahead of the render writes it; without this, people are logged out
// at intervals that look random.

// `/api` is here because those routes do not authenticate by session at all:
// the Collector posts from a machine with no cookie and proves who it is with
// an API key (ADR 0001). Redirecting them to the sign-in page turns every
// report into a 307 the Collector swallows, and nothing anywhere says so.
//
// `/` and `/pricing` are the marketing site (ticket 26). They are the pages a
// visitor arrives on before they have an account at all, so sending them to
// the sign-in page is sending them away.
//
// `'/'` is an exact match below rather than a prefix, which matters: read as
// a prefix it would make every path public. `//keys` would slip past the
// redirect, and it is worth knowing that costs nothing — this file is a
// convenience for the person, and the rows are kept apart by the policies
// (ADR 0001), not by a redirect.
// `/join` is ticket 49's: whoever opens an invitation may have no account at
// all, and that page says so and sends them to sign in with the link kept, so
// the invitation survives the round trip. Redirecting from here would drop it.
const PUBLIC_PATHS = ['/', '/pricing', '/sign-in', '/auth', '/api', '/join']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Unconfigured, every path is as far as this can take anybody: let the
  // request through and let the page say what is missing, rather than
  // redirecting to a sign-in page that cannot work either.
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Verifies the JWT and rotates the token when it is due. Removing this call
  // is what logs people out at random.
  const { data } = await supabase.auth.getClaims()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )

  if (!data?.claims && !isPublic) {
    const signIn = request.nextUrl.clone()
    signIn.pathname = '/sign-in'
    return NextResponse.redirect(signIn)
  }

  // The other direction, which was missing (Taha, 2026-09-22): a signed-in
  // person who reaches the sign-in page has nothing to do there. Signing in
  // again as themselves is the best case; the worst is reading it as proof
  // that the session did not stick and starting again.
  //
  // Here rather than on the page, because the page prerenders (ticket 83) and
  // a redirect decided during a render would cost it its static shell. The
  // Proxy has already read the claims for the check above, so this is the same
  // read.
  //
  // `next` is honoured and passed through `safeNext`, so an invitation link
  // followed while signed in lands on the invitation rather than on Costs.
  // Anything a browser would resolve to another origin is not a path this
  // will redirect to.
  if (data?.claims && path === '/sign-in') {
    // Resolved against the origin rather than assigned to `pathname`: a
    // `next` may carry its own query string, and a path assigned to
    // `pathname` has its `?` escaped into the path.
    const onward = safeNext(request.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(
      new URL(onward ?? '/costs', request.nextUrl.origin),
    )
  }

  return response
}

export const config = {
  // Everything except Next's own assets and the favicon: a static file does
  // not need a session, and refreshing one on every image is wasted work.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
