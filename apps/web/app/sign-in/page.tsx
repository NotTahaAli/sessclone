import Link from 'next/link'
import { Suspense } from 'react'

import { sendMagicLink, signInWithGitHub } from './actions'
import { approvalRequired } from '../../lib/approval'
import { readAnonymously } from '../../lib/db'
import { invitationOrg } from '../../lib/invitations'
import { logoPath } from '../../lib/org-logo'
import { OrgMark } from '../org-mark'
import { LogoMark } from '../_ui/logo'
import { buttonClass, inputClass } from '../_ui/primitives'
import { Notices } from './notices'
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

/** Direction A's round button at full width (ticket 111): one primary. */
const PRIMARY = `${buttonClass('primary')} w-full`
const SECONDARY = `${buttonClass()} w-full`

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

/**
 * The way to the waitlist, for a visitor with no account yet. Not on the way
 * to an invitation, where the visitor joins somebody else's Org, and not with
 * `SIGNUP_APPROVAL=off`, where signing in is signing up.
 */
async function JoinLink({ searchParams }: { searchParams: Query }) {
  if (invitationToken(safeNext((await searchParams).next))) return null
  if (!approvalRequired()) return null
  return (
    <p className="text-text-muted mt-4 text-caption">
      New to SessClone?{' '}
      <Link
        href="/sign-up"
        className="text-text hover:text-accent-text underline underline-offset-2"
      >
        Join the waitlist
      </Link>
    </p>
  )
}

export default function SignIn({ searchParams }: { searchParams: Query }) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16">
      <LogoMark size={28} className="text-text mb-4" />
      <h1 className="text-heading-lg">Sign in to SessClone</h1>

      <Suspense fallback={null}>
        <InvitedBy searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <Notices
          searchParams={searchParams}
          sentMessage="If that address has an account, a sign-in link is on its way. The link works once and expires."
        />
      </Suspense>

      {/* The same failure, when Supabase reported it in the fragment. */}
      <ProviderError />

      {/* One form and two ways to submit it, so `next` travels with either.
          GitHub skips validation: it needs no address. */}
      <form action={sendMagicLink}>
        <Suspense fallback={null}>
          <ReturnTo searchParams={searchParams} />
        </Suspense>

        <button
          type="submit"
          formAction={signInWithGitHub}
          formNoValidate
          className={`${PRIMARY} mt-6`}
        >
          Continue with GitHub
        </button>

        <div className="border-rule mt-6 flex flex-col gap-2 border-t pt-4">
          <label htmlFor="email" className="text-text-muted text-caption">
            Or get a sign-in link by email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            className={`${inputClass} w-full`}
          />
          <button type="submit" className={SECONDARY}>
            Email me a link
          </button>
        </div>
      </form>

      <p className="text-text-muted mt-6 text-caption">
        There is no password to set or forget.
      </p>

      <Suspense fallback={null}>
        <JoinLink searchParams={searchParams} />
      </Suspense>

      <div className="mt-12">
        <PanelCredit />
      </div>
    </main>
  )
}
