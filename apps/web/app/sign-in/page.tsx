import { Suspense } from 'react'

import { sendMagicLink, signInWithGitHub } from './actions'
import { readAnonymously } from '../../lib/db'
import { invitationOrg } from '../../lib/invitations'
import { logoPath } from '../../lib/org-logo'
import { OrgMark } from '../org-mark'
import { safeNext } from '../../lib/auth/next-path'
import { ProviderError } from './provider-error'

// Ticket 83: the page prerenders, and the query string streams into it.
//
// This is the page a signed-out visitor waits on, so it is the one where a
// static shell is worth the most: the heading and both forms are the same for
// everybody, and only two things are not — the error a failed round trip
// reports, and the `next` path an invitation link carries. Those two read
// `searchParams`, so they sit behind a Suspense boundary and the rest of the
// page is prerendered.

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

type Query = Promise<{
  error?: string
  sent?: string
  code?: string
  next?: string
}>

/**
 * Where to come back to, carried through both forms so an invitation link
 * survives the round trip to GitHub or to an inbox.
 *
 * A hidden input rather than a value the page bakes in: it reads the query
 * string, which is what keeps the rest of the page prerenderable.
 */
async function ReturnTo({ searchParams }: { searchParams: Query }) {
  const returnTo = safeNext((await searchParams).next)
  return returnTo ? <input type="hidden" name="next" value={returnTo} /> : null
}

/**
 * The Org's mark, when this page was reached from an invitation (ticket 77).
 *
 * Only then: `/sign-in` on its own belongs to the deployment, not to an Org,
 * and a signed-out visitor has no Org for it to show. The token is already in
 * the URL the visitor followed, so nothing is disclosed by resolving it — and
 * a token that is spent, revoked or invented resolves to nothing, which
 * renders nothing.
 */
async function InvitedBy({ searchParams }: { searchParams: Query }) {
  const returnTo = safeNext((await searchParams).next)
  const token = returnTo?.startsWith('/join/')
    ? decodeURIComponent(returnTo.slice('/join/'.length))
    : null
  if (!token) return null

  const invitation = await readAnonymously((tx) => invitationOrg(tx, token))
  if (!invitation) return null

  return (
    <p>
      <OrgMark
        name={invitation.orgName}
        src={
          invitation.logo ? logoPath(invitation.orgId, invitation.logo) : null
        }
        size={32}
      />{' '}
      You were invited to {invitation.orgName}.
    </p>
  )
}

/** What a failed round trip left in the query string, if anything. */
async function Notices({ searchParams }: { searchParams: Query }) {
  const { error, sent, code } = await searchParams

  return (
    <>
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

      {sent ? (
        <p role="status">
          If that address has an account, a sign-in link is on its way. The link
          works once and expires.
        </p>
      ) : null}
    </>
  )
}

export default function SignIn({ searchParams }: { searchParams: Query }) {
  return (
    <main>
      <h1>Sign in to sessclone</h1>

      <Suspense fallback={null}>
        <InvitedBy searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <Notices searchParams={searchParams} />
      </Suspense>

      {/* The same failure, when Supabase reported it in the fragment. */}
      <ProviderError />

      <form action={signInWithGitHub}>
        <Suspense fallback={null}>
          <ReturnTo searchParams={searchParams} />
        </Suspense>
        <button type="submit">Continue with GitHub</button>
      </form>

      <form action={sendMagicLink}>
        <Suspense fallback={null}>
          <ReturnTo searchParams={searchParams} />
        </Suspense>
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
