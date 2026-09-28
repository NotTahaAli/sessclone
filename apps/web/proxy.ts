import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { safeNext } from './lib/auth/next-path'
import { DEMO_COOKIE } from './lib/demo'
import {
  callbackRedirect,
  fromSite,
  homeRedirect,
  servesPath,
  siteFlags,
} from './lib/site-flags'

// Next 16 calls this Proxy; it is what earlier versions called Middleware.
// Two jobs: refresh the Supabase session on every request, and send a
// signed-out visitor to the sign-in page. Since ticket 138 it also applies the
// site flags, because it is the one place that reads them per request: the
// pages they switch off 404, and `/` goes where the flags and the visitor say.
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

// The pages behind sign-in: the dashboard's sections (`app/(dashboard)`),
// the platform admin and the new-Org step. A signed-out visitor who reaches
// one is sent to the sign-in page; `test/proxy.test.ts` reads the dashboard
// folder, so a new section missing here fails there.
//
// Everything else passes through, signed in or not: the marketing site, the
// docs, the legal pages, `/api` (the Collector proves itself with an API key,
// not a session, ADR 0001), `/auth`, an invitation under `/join`, the files
// crawlers fetch, and a path no route matches, which Next answers with a
// 404. Sending that last one to sign-in was a soft 404 to search engines.
//
// This is a convenience for the person, not the authorisation layer: rows are
// kept apart by the policies (ADR 0001), so a page that slipped past this
// shows an empty dashboard, never somebody else's data.
const PRIVATE_PATHS = [
  '/costs',
  '/devices',
  '/keys',
  '/more',
  '/sessions',
  '/settings',
  '/transcripts',
  '/turns',
  '/admin',
  '/new-org',
]

// Ticket 138: a page a flag switches off. Rewritten to a path no route
// matches, so the app's own not-found page renders, with a 404.
const NOT_SERVED = '/_not-served'

/** A redirect that keeps the session cookies `getClaims` just rotated: a
 * signed-in visit to `/` is every visit to the site for someone who bookmarked
 * it, and a dropped rotation there is a random sign-out. */
const withCookies = (redirect: NextResponse, from: NextResponse) => {
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie)
  return redirect
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const path = request.nextUrl.pathname
  const flags = siteFlags()

  // Ticket 138, first and whoever asks: a page the flags switch off (pricing
  // without the landing page, the docs and their search without docs) is not
  // there. Here rather than in the pages because those prerender, and this
  // reads the flags on every request.
  if (!servesPath(flags, path)) {
    return NextResponse.rewrite(new URL(NOT_SERVED, request.url), {
      status: 404,
    })
  }

  // The deployment's own origin, for the Referer fallback in `fromSite` and
  // for the redirects below:
  // behind a reverse proxy the request's is the server's (`localhost`), not
  // the one the browser was on.
  const configured = process.env.NEXT_PUBLIC_APP_URL
  const origin =
    configured && URL.canParse(configured)
      ? new URL(configured).origin
      : request.nextUrl.origin

  // A redirect from `/` depends on who is asking, so no cache in between
  // (a CDN, a shared proxy) may keep one and hand it to somebody else. It
  // names the deployment's own origin: a relative Location is refused by the
  // Proxy's runtime ("Invalid URL", a 500 on sessclone.com, 2026-09-25), and
  // `request.nextUrl.origin` is the server's `localhost` behind a proxy.
  const uncached = (to: string) => {
    const redirect = NextResponse.redirect(new URL(to, origin))
    redirect.headers.set('Cache-Control', 'private, no-store')
    return redirect
  }

  // A sign-in code Supabase sent to the bare origin goes on to the callback,
  // whatever the flags: it is somebody part-way through signing in.
  const callback = callbackRedirect(path, request.nextUrl.searchParams)
  if (callback) return uncached(callback)

  // Where `/` sends this visitor, or null for the landing page (ticket 138).
  const home = (session: boolean, demoCookie: boolean) => {
    if (path !== '/') return null
    const to = homeRedirect(flags, {
      session,
      demoCookie,
      fromSite: fromSite(request.headers, origin),
    })
    return to ? uncached(to) : null
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Unconfigured, every path is as far as this can take anybody: let the
  // request through and let the page say what is missing, rather than
  // redirecting to a sign-in page that cannot work either. With no landing
  // page, `/` still goes to that page, which says it.
  if (!url || !key) return home(false, false) ?? response

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

  const isPrivate = PRIVATE_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )

  // Ticket 137: the demo visitor has no session and is let through; the
  // pages resolve them in `sessionUser`, which honours the same cookie.
  const demoCookie = request.cookies.get(DEMO_COOKIE)?.value === '1'
  const demo = flags.demo && demoCookie

  // Ticket 138: `/`. Signed in (the demo visitor too, where the demo runs), a
  // direct visit opens the dashboard; with no landing page, so does every
  // visit, and a signed-out one goes to sign-in.
  const redirectHome = home(Boolean(data?.claims), demoCookie)
  if (redirectHome) return withCookies(redirectHome, response)

  if (!data?.claims && isPrivate && !demo) {
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
  if (data?.claims && (path === '/sign-in' || path === '/sign-up')) {
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
