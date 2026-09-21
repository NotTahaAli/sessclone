import { sendMagicLink, signInWithGitHub } from './actions'
import { safeNext } from '../../lib/auth/next-path'
import { ProviderError } from './provider-error'

// Cache Components (ticket 80) prerenders a static shell for every route and
// refuses one that reads request data outside a Suspense boundary. This page
// is reached signed out and still reads request data before rendering — the
// `next` parameter here, the token and any session there — so `false` turns
// the validation off rather than satisfying it, and the route renders at
// request time as it always has. Deferred with the rest: ticket 83.
export const instant = false

// Deliberately unstyled. The design system (ticket 16) is documented and not
// yet built — there is no Tailwind, no `globals.css` and no shell in this app
// — and ticket 45 is where the shell and these tokens land. Markup first, so
// that ticket dresses a page that already works rather than one that has to be
// rewritten to.

const MESSAGES: Record<string, string> = {
  github: 'GitHub sign-in could not be started. Try again, or use a link.',
  email: 'That does not look like an email address.',
  link: 'The link could not be sent. Try again in a moment.',
  exchange: 'That sign-in could not be completed. Start again.',
  callback: 'That link is missing something. Start again.',
  session: 'Signed in, but the session did not stick. Start again.',
  identity:
    'That email address already belongs to an account signed in a different way. Use the way you signed in the first time.',
  bootstrap: 'Signed in, but your organisation could not be set up. Try again.',
}

// Matched, never rendered as it arrives — see `app/auth/callback/route.ts`.
const PROVIDER_CODE = /^[a-z_]{1,64}$/

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string
    sent?: string
    code?: string
    next?: string
  }>
}) {
  const { error, sent, code, next } = await searchParams

  // Carried through both forms so an invitation link survives the round trip
  // to GitHub or to an inbox.
  const returnTo = safeNext(next)

  return (
    <main>
      <h1>Sign in to sessclone</h1>

      {error === 'provider' ? (
        <p role="alert">
          The provider refused the sign-in (
          {code && PROVIDER_CODE.test(code) ? code : 'unknown'}). Nothing is
          wrong with your account. Check the provider&apos;s settings in
          Supabase, or use a link instead.
        </p>
      ) : error ? (
        <p role="alert">{MESSAGES[error] ?? 'Something went wrong.'}</p>
      ) : null}

      {/* The same failure, when Supabase reported it in the fragment. */}
      <ProviderError />

      {sent ? (
        <p role="status">
          If that address has an account, a sign-in link is on its way. The link
          works once and expires.
        </p>
      ) : null}

      <form action={signInWithGitHub}>
        {returnTo ? <input type="hidden" name="next" value={returnTo} /> : null}
        <button type="submit">Continue with GitHub</button>
      </form>

      <form action={sendMagicLink}>
        {returnTo ? <input type="hidden" name="next" value={returnTo} /> : null}
        <label htmlFor="email">Or get a sign-in link by email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
        />
        <button type="submit">Email me a link</button>
      </form>

      <p>
        There is no password to set or forget. Signing in for the first time
        creates an organisation with you as its owner.
      </p>
    </main>
  )
}
