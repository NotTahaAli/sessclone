import type { ReactNode } from 'react'

import { AccountMenu } from './account'
import { PanelCredit } from './credit'
import { BottomBarLinks, SidebarLinks } from './nav-links'
import { DESTINATIONS } from './navigation'
import { currentViewer } from '../../lib/viewer'

// Cache Components (ticket 80) prerenders a static shell for every route and
// refuses one that reads request data outside a Suspense boundary. This route
// reads the session before it renders anything, so today it has no shell at
// all: `false` turns the validation off rather than satisfying it, and the
// route renders at request time as it always has.
//
// That is a deferral, not a design. The chrome here — the sidebar, the bottom
// bar, the Org name's frame — is exactly what a shell is for, and reaching it
// means wrapping the session read in a Suspense boundary so the frame
// prerenders around it. Ticket 83.
export const instant = false

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
//  - **The licence's Appropriate Legal Notices** (ticket 79), which used to
//    be rendered by the `Panel` frame every signed-in page wrapped in. They
//    are rendered here instead, so a page added later carries them by being a
//    page rather than by remembering to.
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

/**
 * What a non-active subscription says, in the reader's terms.
 *
 * Neutral tokens and not an alarm: nothing is broken and nothing has been
 * lost. The three states differ in why, so each says its own why rather than
 * one sentence covering all of them badly.
 */
function Inactive({
  status,
}: {
  status: 'inactive' | 'past_due' | 'cancelled'
}) {
  const said = {
    inactive:
      'This Org is not activated yet. Collection works and nothing is lost; whoever operates this deployment turns it on.',
    past_due:
      'This Org’s subscription is past due. Collection works and nothing is lost; whoever operates this deployment can sort it out.',
    cancelled:
      'This Org’s subscription has been cancelled. Collection works and nothing is lost, and whoever operates this deployment can turn it back on.',
  }[status]

  return (
    <p
      role="status"
      className="border-rule bg-surface text-text-secondary mb-6 rounded-md border p-3 text-caption"
    >
      {said}
    </p>
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
        {/* The account block, and the credit under it — which is where the
            wireframes put the self-hosting credit at 1440. It is shown on
            every deployment rather than only a self-hosted one, because the
            additional term in `NOTICE.md` makes no such distinction. */}
        <div className="flex flex-col gap-4">
          <AccountMenu viewer={viewer} />
          <PanelCredit />
        </div>
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
      <main className="grow px-4 py-6 pb-28 lg:px-8 lg:pb-8">
        {/* Ticket 48: an Org whose subscription is not active is told so, on
            every page, rather than shown a dashboard that quietly means less
            than it looks like it does. No subscription row is the same answer
            as an inactive one — it is the state every Org starts in, and the
            commonest reason a person is reading this notice. Collection keeps
            working either way: refusing the Org's own history would be a
            worse answer than saying what is true. */}
        {viewer.subscriptionStatus === 'active' ? null : (
          <Inactive status={viewer.subscriptionStatus ?? 'inactive'} />
        )}
        {children}
        {/* At phone width the sidebar is not rendered at all, so the notices
            go under the content instead. One of the two is visible at a
            time. */}
        <div className="lg:hidden">
          <PanelCredit />
        </div>
      </main>

      <nav
        aria-label="Main"
        className="border-rule bg-ground fixed inset-x-0 bottom-0 z-10 border-t lg:hidden"
      >
        <BottomBarLinks items={DESTINATIONS} />
      </nav>
    </div>
  )
}
