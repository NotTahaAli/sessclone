import { Suspense } from 'react'

import { sendMagicLink, signInWithGitHub } from './actions'
import { readAnonymously } from '../../lib/db'
import { invitationOrg } from '../../lib/invitations'
import { logoPath } from '../../lib/org-logo'
import { OrgMark } from '../org-mark'
import { LogoMark } from '../_ui/logo'
import { invitationToken, safeNext } from '../../lib/auth/next-path'
import { ProviderError } from './provider-error'
import { PanelCredit } from '../(dashboard)/credit'

// Ticket 83: the page prerenders, and the query string streams into it.
//
// This is the page a signed-out visitor waits on, so it is the one where a
// static shell is worth the most: the heading and both forms are the same for
// everybody, and only two things are not — the error a failed round trip
// reports, and the `next` path an invitation link carries. Those two read
// `searchParams`, so they sit behind a Suspense boundary and the rest of the
// page is prerendered.

// Styled from the design system's tokens (ticket 16), in the same one-column
// frame `app/join/[token]/page.tsx` uses: both are pages a visitor reaches
// before they are in any Org, so neither has a shell to sit in and both carry
// the panel's Appropriate Legal Notices themselves (ticket 79).

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

/** The one control both forms submit through, so they read as one choice. */
const BUTTON =
  'inline-flex h-[var(--control-h)] w-full items-center justify-center rounded-md px-4 text-body'

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
  const token = invitationToken(safeNext((await searchParams).next))
  if (!token) return null

  const invitation = await readAnonymously((tx) => invitationOrg(tx, token))
  if (!invitation) return null

  return (
    <p className="text-text-secondary mt-4 flex items-center gap-2 text-body">
      <OrgMark
        name={invitation.orgName}
        src={
          invitation.logo ? logoPath(invitation.orgId, invitation.logo) : null
        }
        size={32}
      />
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
        <p
          role="alert"
          className="border-bad-border bg-bad-bg text-bad-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          The provider refused the sign-in (
          {code && PROVIDER_CODE.test(code) ? code : 'unknown'}). Nothing is
          wrong with your account. Check the provider&apos;s settings in
          Supabase, or use a link instead.
        </p>
      ) : error ? (
        <p
          role="alert"
          className="border-bad-border bg-bad-bg text-bad-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          {MESSAGES[error] ?? 'Something went wrong.'}
        </p>
      ) : null}

      {sent ? (
        <p
          role="status"
          className="border-ok-border bg-ok-bg text-ok-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          If that address has an account, a sign-in link is on its way. The link
          works once and expires.
        </p>
      ) : null}
    </>
  )
}

export default function SignIn({ searchParams }: { searchParams: Query }) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16">
      <LogoMark size={28} className="text-text mb-4" />
      <h1 className="text-heading-lg">Sign in to sessclone</h1>

      <Suspense fallback={null}>
        <InvitedBy searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <Notices searchParams={searchParams} />
      </Suspense>

      {/* The same failure, when Supabase reported it in the fragment. */}
      <ProviderError />

      <form action={signInWithGitHub} className="mt-6">
        <Suspense fallback={null}>
          <ReturnTo searchParams={searchParams} />
        </Suspense>
        <button
          type="submit"
          className={`${BUTTON} bg-accent-fill text-accent-on-fill`}
        >
          Continue with GitHub
        </button>
      </form>

      <form
        action={sendMagicLink}
        className="border-rule bg-surface mt-6 flex flex-col gap-2 rounded-md border p-4"
      >
        <Suspense fallback={null}>
          <ReturnTo searchParams={searchParams} />
        </Suspense>
        <label htmlFor="email" className="text-text-secondary text-caption">
          Or get a sign-in link by email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="border-control-border text-text h-[var(--control-h)] w-full rounded border px-3 text-body"
        />
        <button
          type="submit"
          className={`${BUTTON} border-control-border text-text border`}
        >
          Email me a link
        </button>
      </form>

      <p className="text-text-muted mt-6 text-caption">
        There is no password to set or forget. Signing in for the first time
        creates an organisation with you as its owner.
      </p>

      <div className="mt-12">
        <PanelCredit />
      </div>
    </main>
  )
}
