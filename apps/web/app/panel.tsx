import type { ReactNode } from 'react'

import { REPOSITORY } from './(marketing)/constants'
import { signOut } from './sign-in/actions'

// The frame every signed-in page hangs from until ticket 45 builds the real
// shell. It started as a header copied into `/keys`; ticket 72 needed the same
// header and ticket 79 needed the same footer on both, and two copies of a
// frame is how two pages stop looking like one product.
//
// Nothing here is the navigation ticket 45 owns. It answers "who am I signed
// in as", gives a way out, and carries the credit.

/** Where the licence, its additional term and the source all live. */
export const LICENSE_URL = `${REPOSITORY}/blob/main/LICENSE`
export const NOTICE_URL = `${REPOSITORY}/blob/main/NOTICE.md`

/**
 * The panel's Appropriate Legal Notices, and the sessclone credit with them
 * (ticket 79).
 *
 * This is deliberately not a "Powered by" line on its own. AGPL-3.0 section
 * 7(b) permits an additional term requiring preservation of "legal notices or
 * author attributions in that material or in the Appropriate Legal Notices
 * displayed by works containing it" — so a term hung on a marketing sentence
 * is not a 7(b) term at all, and section 7 hands a recipient the right to
 * strip any non-permissive term that is not one of (a) to (f).
 *
 * Section 0 says what an interactive interface has to show to be displaying
 * Appropriate Legal Notices: a copyright notice, that there is no warranty,
 * that licensees may convey the work under this licence, and how to read it.
 * All four are below, which is what the additional term in `NOTICE.md`
 * actually requires be preserved.
 *
 * It is ordinary markup in an open repository — of course it can be deleted.
 * Nothing checks for it at runtime and nothing will: a tamper check would make
 * a worse promise than the licence already makes. Deleting it and conveying or
 * network-deploying the result is a licence breach, which is a different kind
 * of problem from a technical one, and the honest place to put it.
 */
export function PanelCredit() {
  return (
    <footer className="border-rule text-caption text-text-muted mt-10 flex flex-col gap-1 border-t pt-4">
      <p>
        Powered by{' '}
        <a href={REPOSITORY} className="hover:text-accent-text underline">
          sessclone
        </a>{' '}
        · Copyright © 2026 sessclone contributors
      </p>
      <p>
        No warranty, to the extent permitted by law. You may convey this work
        under the{' '}
        <a href={LICENSE_URL} className="hover:text-accent-text underline">
          GNU AGPL v3
        </a>
        , with the{' '}
        <a href={NOTICE_URL} className="hover:text-accent-text underline">
          additional term
        </a>{' '}
        that keeps this notice visible.
      </p>
    </footer>
  )
}

/**
 * One signed-in page: the header, the page, and the credit under it.
 *
 * `email` and `memberships` are passed in rather than read here, so the page's
 * one `asViewer` transaction stays the page's one transaction. The rows go in
 * as the query returned them, and the Org names are joined here — a page that
 * mapped them first would hand this a fresh array on every render.
 */
export function Panel({
  email,
  memberships,
  children,
}: {
  email: string | undefined
  memberships: readonly { org_name: string }[]
  children: ReactNode
}) {
  return (
    <main className="bg-ground text-text mx-auto max-w-3xl p-6">
      <header className="border-rule flex flex-wrap items-baseline justify-between gap-3 border-b pb-4">
        <p className="text-text-secondary text-sm">
          Signed in as {email}
          {memberships.length > 0 ? (
            <> · {memberships.map((m) => m.org_name).join(', ')}</>
          ) : null}
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="border-control-border text-text rounded border px-2 py-1 text-sm"
          >
            Sign out
          </button>
        </form>
      </header>

      {children}

      <PanelCredit />
    </main>
  )
}
