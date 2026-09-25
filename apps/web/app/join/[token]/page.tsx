import Link from 'next/link'

import { AcceptForm } from './accept-form'
import { PanelCredit } from '../../(dashboard)/credit'
import { realSessionUser } from '../../../lib/supabase/server'

// Cache Components (ticket 80) prerenders a static shell for every route. The
// dashboard earns a real one by streaming the viewer into a static frame
// (ticket 83); this page does not, and that is the answer rather than a
// deferral: which of the two pages below a visitor gets *is* the session
// read, and the token is in the path, so the only thing a shell could
// prerender is a frame that says nothing. There is no chrome here on purpose
// — whoever opens this may not be in any Org yet.
//
// The empty shell comes from that session read sitting outside any Suspense
// boundary. `instant = false` only stops instant-navigation validation from
// listing the route as work still to do.
export const instant = false

// Ticket 49: where an invitation is accepted.
//
// Outside the dashboard shell on purpose: whoever opens this may not be in any
// Org yet, so there is no sidebar to render and nothing to put in it.
//
// The acceptance runs on the viewer's own connection, and every rule — expiry,
// replay, the address it was sent to, the Seat — lives in
// `sessclone_accept_invitation`, because the person accepting may read none of
// the rows those rules are about. It runs from the Server Action in
// `actions.ts`, never from this render: see the note there.

export default async function Join({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // Ticket 137: the demo visitor is signed out here.
  const user = await realSessionUser()

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

  // Nothing is read or written by rendering this page. The acceptance is the
  // button below, because joining an Org is a write and a write that happens
  // by loading a URL is one anything can trigger on the visitor's behalf.
  return (
    <Shell headline="Accept this invitation">
      <p className="text-text-secondary text-sm">
        You are signed in as {user.email}. An invitation only works for the
        address it was sent to, and only once.
      </p>
      <AcceptForm token={token} />
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
