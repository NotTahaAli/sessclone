import type { ReactNode } from 'react'

import { AccountMenu } from './account'
import { BottomBarLinks, SidebarLinks } from './nav-links'
import { DESTINATIONS } from './navigation'
import { currentViewer } from '../../lib/viewer'

// Ticket 45: the signed-in frame every later page hangs from.
//
// Three things it establishes, and they are the ticket's criteria:
//
//  - **Navigation reflecting what the Role may reach.** Four destinations,
//    every one of them reachable by all four Roles; the choice a Role does
//    change is inside Settings, and `/settings` makes it. The list is
//    filtered on the server, so what a Role may reach never ships to the
//    browser as data the browser decides on.
//  - **Org context, established and visible.** The Org name sits in the
//    frame at both widths, next to the account control, because every figure
//    on every page under here is an Org's figure and a reader who cannot see
//    whose is reading an unlabelled number.
//  - **The states before any Turn arrives**, which are `costs/page.tsx`,
//    `loading.tsx` and `error.tsx` — drawn from the wireframes rather than
//    improvised, which is the fourth criterion.
//
// **The layout follows the wireframes where they and the design system
// disagree.** `docs/design/design-system.md` describes an AppBar that
// "collapses to a menu button under 700px"; `docs/design/dashboard-wireframes.md`
// draws a 232px sidebar at 1440px and a bottom bar of four at 390px.
// `docs/design/product-ia.md` settles which document decides: "It does not
// decide layout — ticket 18 owns the wireframes". So the sidebar and the
// bottom bar are what is built, and the design system still decides every
// token, every component's parts and the accent rule those parts follow.
//
// The two widths show the same four destinations in the same order, which is
// the wireframes' own requirement: nothing appears on one and not the other.

/**
 * What a signed-in person with no Org sees. Not a redirect: a redirect to the
 * sign-in page from a page that *is* signed in is a loop, and this is what a
 * deployment with no database configured looks like from here.
 */
function WithoutOrg() {
  return (
    <main className="bg-ground text-text mx-auto max-w-2xl p-6">
      <h1 className="text-heading-lg">No Org yet</h1>
      <p className="text-text-secondary mt-2 text-body">
        You are signed in, but this account is not a Member of any Org. Signing
        out and back in creates one; if it does not, the deployment&apos;s
        database is not reachable.
      </p>
    </main>
  )
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const viewer = await currentViewer()
  if (!viewer) return <WithoutOrg />

  return (
    <div className="bg-ground text-text min-h-dvh lg:flex">
      {/* Desktop: the 232px sidebar, holding the same four destinations and
          the account block. */}
      <aside
        // 232px, which is what the wireframes draw at 1440.
        className="border-rule hidden w-[232px] shrink-0 flex-col justify-between border-r p-4 lg:flex"
      >
        <div>
          <p className="text-label text-text-muted uppercase">sessclone</p>
          <p className="text-heading mt-1 truncate" title={viewer.orgName}>
            {viewer.orgName}
          </p>
          <nav aria-label="Main" className="mt-6">
            <SidebarLinks items={DESTINATIONS} />
          </nav>
        </div>
        <AccountMenu viewer={viewer} />
      </aside>

      {/* Phone: the header carries the Org name and the account control, and
          the four destinations are a bottom bar. */}
      <header className="border-rule bg-ground sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-2 lg:hidden">
        <p className="truncate">
          <span className="text-label text-text-muted block uppercase">
            sessclone
          </span>
          <span className="text-heading block truncate">{viewer.orgName}</span>
        </p>
        <AccountMenu viewer={viewer} />
      </header>

      {/* The bottom bar is fixed, so the content column reserves room for it
          rather than ending underneath it. */}
      <main className="grow px-4 py-6 pb-28 lg:px-8 lg:pb-8">{children}</main>

      <nav
        aria-label="Main"
        className="border-rule bg-ground fixed inset-x-0 bottom-0 z-10 border-t lg:hidden"
      >
        <BottomBarLinks items={DESTINATIONS} />
      </nav>
    </div>
  )
}
