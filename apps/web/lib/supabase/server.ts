import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

import { DEMO_COOKIE, DEMO_EMAIL, DEMO_USER_ID, demoEnabled } from '../demo'
import { viewerLocked } from '../viewer'

// Supabase Auth owns sign-in and the session cookie, and nothing else (ADR
// 0007). Every row this app reads comes through `lib/db.ts` as the signed-in
// person; this client exists to answer one question — who is signed in — and
// to keep their session fresh.
//
// `docs/configuration.md` names all three variables. The anon key is public by
// design: row-level security is what protects the rows, not the key. The
// service role key is not read here and must never be: ADR 0001 confines it to
// ingest paths that have already verified an API key.
const configured = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // As with `DATABASE_URL`: name what is missing, rather than failing three
  // layers down inside the client with something about an invalid URL.
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set')
  return { url, key }
}

/**
 * The client for a Server Component, a Server Function, or a Route Handler.
 *
 * Cookies are read from the request and written back through `setAll`. Next
 * refuses a cookie write during Server Component rendering — HTTP cannot set
 * one after streaming has started — so that case is swallowed: the Proxy
 * refreshes the session on every request, so a token rotated during a render
 * is written on the next one rather than lost.
 */
export const supabaseServer = async () => {
  const { url, key } = configured()
  const store = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options)
          }
        } catch {
          // Rendering a Server Component. See above.
        }
      },
    },
  })
}

/**
 * The signed-in person, or null, whatever state their Org is in.
 *
 * `getClaims` verifies the JWT rather than trusting the cookie's contents,
 * which is the difference between a session and a claim anybody could write.
 *
 * Only for what must keep working while the Org is locked (ticket 119): the
 * shell that draws the waiting page, the operator's area, accepting an
 * invitation, and the routes that answer a locked Org with their own 403.
 * Everything else asks `signedInUser`.
 */
export const sessionUser = async () => {
  const claims = await verifiedClaims()

  // Ticket 137: with no session at all, the demo cookie makes this the demo
  // visitor. Only then, so a signed-in person always sees their own Orgs. A
  // session `getClaims` refuses is no claims, and without the demo cookie
  // that is null as it always was.
  if (!claims) return demoVisitor()
  return personOf(claims)
}

/**
 * The signed-in person from a real Supabase session, never the demo visitor
 * (ticket 137): for the pages that act on a real account — accepting an
 * invitation, starting an Org — where the demo must read as signed out.
 */
export const realSessionUser = async () => {
  const claims = await verifiedClaims()
  return claims ? personOf(claims) : null
}

const verifiedClaims = async () => {
  const supabase = await supabaseServer()
  const { data } = await supabase.auth.getClaims()
  return data?.claims ?? null
}

const personOf = (claims: { sub?: unknown; email?: unknown }) =>
  typeof claims.sub === 'string' &&
  claims.sub &&
  typeof claims.email === 'string'
    ? { id: claims.sub, email: claims.email }
    : null

/**
 * The demo visitor, when the deployment runs the demo and this browser asked
 * for it at `/demo`. Every read then runs as them under the same policies as
 * anybody (ADR 0001), and `asViewer` makes each of their transactions
 * read-only.
 */
const demoVisitor = async () =>
  demoEnabled() && (await cookies()).get(DEMO_COOKIE)?.value === '1'
    ? { id: DEMO_USER_ID, email: DEMO_EMAIL }
    : null

/**
 * The signed-in person, or null — and null too while their Org is locked
 * (ticket 119).
 *
 * This is the lock for every Server Action, applied once. An action is a POST
 * anybody can make whether or not a page rendered its form, and the waiting
 * page hides the forms, not the endpoints; so the refusal sits in the one
 * question every dashboard action asks first, and an action added later is
 * locked without knowing it has to be. `currentViewer` refuses the same way,
 * for the actions that start there. Next's own guidance is to verify inside
 * each Server Function rather than in the Proxy
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * proxy.md`, "Server Functions ... are handled as POST requests"), which is
 * why this is not there. Sign out asks neither, and the operator's area goes
 * through `sessionUser`, so neither is locked by the operator's own Org.
 */
export const signedInUser = async () => {
  const user = await sessionUser()
  return user && !(await viewerLocked()) ? user : null
}
