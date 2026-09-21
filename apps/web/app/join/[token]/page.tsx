import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PanelCredit } from '../../(dashboard)/credit'
import { asViewer } from '../../../lib/db'
import { acceptFailure, acceptInvitation } from '../../../lib/invitations'
import { signedInUser } from '../../../lib/supabase/server'

// Ticket 49: where an invitation is accepted.
//
// Outside the dashboard shell on purpose: whoever opens this may not be in any
// Org yet, so there is no sidebar to render and nothing to put in it.
//
// The acceptance runs on the viewer's own connection, and every rule — expiry,
// replay, the address it was sent to, the Seat — lives in
// `sessclone_accept_invitation`, because the person accepting may read none of
// the rows those rules are about.

export default async function Join({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const user = await signedInUser()

  // Signed out: sign in first and come back here. The token stays in the URL
  // rather than moving into a cookie, so nothing about it is stored anywhere
  // this page controls.
  if (!user) {
    const next = encodeURIComponent(`/join/${token}`)
    return (
      <Shell headline="Sign in to accept this invitation">
        <p className="text-text-secondary text-sm">
          An invitation is for one address, so it only works once you are signed
          in as the person it was sent to.
        </p>
        <Link
          href={`/sign-in?next=${next}`}
          className="border-control-border text-text mt-4 inline-block rounded border px-3 py-1 text-sm"
        >
          Sign in
        </Link>
      </Shell>
    )
  }

  let failure: string
  try {
    await asViewer(user.id, (tx) => acceptInvitation(tx, token))
    // Accepted. Straight to Costs, which is where a new Member starts.
    // Outside the `try`, because `redirect` throws by design and catching it
    // here would report a successful join as a failed one.
    failure = ''
  } catch (error) {
    // Caught here rather than inside the transaction: a raise aborts it, so
    // the error surfaces again when the transaction ends however carefully the
    // failing statement was wrapped.
    failure = acceptFailure(error)
  }

  if (!failure) redirect('/costs')

  return (
    <Shell headline="This invitation cannot be used">
      <p className="text-text-secondary text-sm">{failure}</p>
      <p className="text-text-muted mt-2 text-sm">
        Whoever invited you can send another one.
      </p>
      <Link
        href="/costs"
        className="border-control-border text-text mt-4 inline-block rounded border px-3 py-1 text-sm"
      >
        Go to the dashboard
      </Link>
    </Shell>
  )
}

function Shell({
  headline,
  children,
}: {
  headline: string
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16">
      <h1 className="text-heading-lg">{headline}</h1>
      <div className="mt-3">{children}</div>
      {/* This page is outside the dashboard shell, so it carries the panel's
          Appropriate Legal Notices itself (ticket 79). */}
      <div className="mt-12">
        <PanelCredit />
      </div>
    </main>
  )
}
