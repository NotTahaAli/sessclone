'use client'

import { useSyncExternalStore } from 'react'

// Supabase reports a provider failure in the URL *fragment*:
//
//   /auth/callback#error=server_error&error_code=unexpected_failure&...
//
// A fragment never reaches the server, so `app/auth/callback/route.ts` sees a
// request with no `code` and no `token_hash` and can only say the link was
// missing something — which is true and useless, because the reason is sitting
// in the address bar unread. This is the one piece of that flow that has to
// run in the browser.
//
// Only the error code is shown, never `error_description`. The description is
// free text from a third party rendered on our own sign-in page, which is a
// place to tell somebody to call a number; the code is a short identifier that
// is worth searching for and cannot carry a sentence.
const CODE = /^[a-z_]{1,64}$/

// The fragment is read as an external store rather than in an effect: reading
// `window` during render is a hydration mismatch, and an effect that calls
// `setState` immediately renders twice for a value that never changes. It is
// whatever it was when the page loaded, so nothing subscribes.
const subscribe = () => () => {}
const readHash = () => window.location.hash
const serverHash = () => ''

export function ProviderError() {
  const reported = new URLSearchParams(
    useSyncExternalStore(subscribe, readHash, serverHash).slice(1),
  )

  if (!reported.get('error')) return null

  const code = reported.get('error_code')

  return (
    <p
      role="alert"
      className="border-bad-border bg-bad-bg text-bad-text mt-4 rounded-md border px-3 py-2 text-caption"
    >
      The provider refused the sign-in (
      {code && CODE.test(code) ? code : 'unknown'}
      ). Nothing is wrong with your account. Check the provider&apos;s settings
      in Supabase, or use a link instead.
    </p>
  )
}
