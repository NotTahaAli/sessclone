import { createClient } from '@supabase/supabase-js'

// Ticket 141: removing a deleted person's sign-in (`auth.users`).
//
// The one use of the service role key in the app, and server side only: the
// retention sweep route calls it behind its secret, after the scrub in SQL.
// Taha, 2026-09-25, chose the Admin API over deleting from `auth.users` in
// SQL, since it is Supabase's supported path. A deployment without the key
// throws here, the scrubbed person is retried on the next sweep, and the
// Admin panel lists them meanwhile.

/**
 * Deletes one sign-in. "Already gone" (404) is success, so a retry after a
 * lost response is safe.
 */
export const removeSignIn = async (userId: string) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error && error.status !== 404) throw error
}
