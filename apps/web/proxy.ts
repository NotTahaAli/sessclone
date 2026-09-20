import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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
const PUBLIC_PATHS = ['/sign-in', '/auth', '/api']

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

  return response
}

export const config = {
  // Everything except Next's own assets and the favicon: a static file does
  // not need a session, and refreshing one on every image is wasted work.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
