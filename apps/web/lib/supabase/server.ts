import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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
 * The signed-in person, or null.
 *
 * `getClaims` verifies the JWT rather than trusting the cookie's contents,
 * which is the difference between a session and a claim anybody could write.
 */
export const signedInUser = async () => {
  const supabase = await supabaseServer()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims

  if (!claims?.sub || typeof claims.email !== 'string') return null

  return { id: claims.sub, email: claims.email }
}
