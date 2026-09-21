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

/**
 * The sessclone credit a self-hosted deployment keeps (ticket 79).
 *
 * The licence is AGPL-3.0-only with one additional term under section 7(b),
 * written out in `NOTICE.md`: this line, and the link on it, stay visible on
 * the panel. Section 7(b) is the single hook copyleft offers for attribution,
 * so the credit is a condition of the licence rather than something the code
 * tries to stop anybody editing. It is ordinary markup in an open repository —
 * of course it can be deleted. Deleting it and running the result for other
 * people is a licence breach, which is a different kind of problem from a
 * technical one, and the honest place to put it.
 */
export function PanelCredit() {
  return (
    <footer className="border-rule text-caption text-text-muted mt-10 border-t pt-4">
      <p>
        Powered by{' '}
        <a href={REPOSITORY} className="hover:text-accent-text underline">
          sessclone
        </a>{' '}
        — open source, self-hostable, free at any size.
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
