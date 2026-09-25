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
// `/docs` is ticket 116's: the install and self-hosting guides are read before
// anybody has an account. (`/api/search`, the docs search, is under `/api`.)
// `/privacy` and `/terms` are the legal pages the marketing footer links to.
// `/demo` is ticket 137's way into the demo, which 404s when it is off.
const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/sign-in',
  '/sign-up',
  '/auth',
  '/api',
  '/join',
  '/docs',
  '/privacy',
  '/terms',
  '/demo',
]

// The files crawlers, browsers and link previews fetch with no cookie: the
// metadata routes Next serves from `app/` (robots, sitemap, icons, Open Graph
// and Twitter images, the manifest), `llms.txt` and `security.txt`. Exact names,
// with the `icon*`/`*-image*` families' generated suffixes (`icon0.png`,
// `opengraph-image-abc123`). A redirect here is a missing favicon or a blank
// share card, and a crawler reading `/sign-in` as the whole site.
const PUBLIC_FILE =
  /^\/(?:robots\.txt|sitemap\.xml|favicon\.ico|manifest\.webmanifest|llms\.txt|\.well-known\/security\.txt|(?:apple-)?icon[^/]*|(?:opengraph|twitter)-image[^/]*)$/

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

// A redirect from `/` depends on who is asking, so no cache in between
// (a CDN, a shared proxy) may keep one and hand it to somebody else. The
// Location is relative (RFC 9110 allows it), as `/demo`'s is: behind a
// reverse proxy `request.nextUrl.origin` is the server's own (`localhost`),
// which the browser cannot reach.
const uncached = (to: string) =>
  new NextResponse(null, {
    status: 307,
    headers: { location: to, 'cache-control': 'private, no-store' },
  })

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

  // A sign-in code Supabase sent to the bare origin goes on to the callback,
  // whatever the flags: it is somebody part-way through signing in.
  const callback = callbackRedirect(path, request.nextUrl.searchParams)
  if (callback) return uncached(callback)

  // The deployment's own origin, for the Referer fallback in `fromSite`:
  // behind a reverse proxy the request's is the server's (`localhost`), not
  // the one the browser was on.
  const configured = process.env.NEXT_PUBLIC_APP_URL
  const origin =
    configured && URL.canParse(configured)
      ? new URL(configured).origin
      : request.nextUrl.origin

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

  const isPublic =
    PUBLIC_FILE.test(path) ||
    PUBLIC_PATHS.some(
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

  if (!data?.claims && !isPublic && !demo) {
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
