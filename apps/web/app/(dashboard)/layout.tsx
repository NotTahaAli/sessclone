import { Suspense, type ReactNode } from 'react'

import { AccountMenu } from './account'
import { AppearanceSync } from './appearance-sync'
import { LogoMark } from '../_ui/logo'
import { OrgMark } from '../org-mark'
import { PanelCredit } from './credit'
import {
  BottomBarLinks,
  BottomBarLinksPending,
  SidebarGroups,
  SidebarGroupsPending,
  SidebarLinks,
} from './nav-links'
import {
  ADMIN_PANEL,
  BOTTOM_BAR,
  MORE,
  moreItems,
  navGroups,
} from './navigation'
import Loading from './loading'
import { currentOperator } from '../../lib/platform-admin'
import { currentViewer } from '../../lib/viewer'

// Ticket 83: this layout prerenders a static shell.
//
// Cache Components (ticket 80) prerenders a shell for every route and refuses
// one that reads request data outside a Suspense boundary. This layout used
// to read the session before rendering anything and opted out, which shipped
// a zero-byte shell for every signed-in route — the sidebar, the bottom bar
// and the frame all waited on a database read that says nothing about them.
//
// Now the frame is static and the things that depend on who is asking stream
// into it: the Org name, the account menu, the admin entry, and the content
// column (which carries the subscription notice and the page itself). The
// bottom bar and the sidebar's groups are the same for every Role — the Role
// only changes what is inside Settings — so nothing about them needs the
// viewer, and a reader on a slow connection sees the frame at once.
//
// Ticket 85 adds the one exception, and it sits in a boundary of its own for
// exactly that reason: the Admin panel entry depends on `is_platform_admin`,
// which is a database read, so it streams in beneath a frame that has already
// painted rather than holding the frame back for a flag that is false for
// almost every reader.

// Ticket 45: the signed-in frame every later page hangs from.
//
// Three things it establishes, and they are the ticket's criteria:
//
//  - **Navigation reflecting what the Role may reach.** Six destinations in
//    three groups (ticket 85), every one of them reachable by all four Roles;
//    the choice a Role does change is inside Settings, and `/settings` makes
//    it. The one conditional entry is the Admin panel, which is the platform
//    flag rather than a Role. Both are decided on the server, so what a reader
//    may reach never ships to the browser as data the browser decides on.
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
// The two widths show the same destinations in the same order, which is the
// wireframes' own requirement: nothing appears on one and not the other. Six
// do not fit a bottom bar, so the phone carries the first group and a More
// entry onto the rest (ticket 85) — one tap further, not absent.

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

/** The Org name, which every figure under here belongs to. */
async function OrgName({ className }: { className: string }) {
  const viewer = await currentViewer()
  if (!viewer) return <span className={className}>No Org</span>

  // Ticket 77: an uploaded logo sits beside the name, never instead of it,
  // since a logo is not a label. It rides on the viewer's own row rather than
  // being read here, so the shell still costs one transaction.
  //
  // Ticket 111 (assumption, stated): Direction A's brand line is the sessclone
  // mark then the Org name, so an Org with no logo shows no initial tile — the
  // tile repeated the first letter of the name right beside it.
  return (
    <span className="flex min-w-0 items-center gap-2">
      {viewer.orgLogo ? (
        <OrgMark name={viewer.orgName} src={viewer.orgLogo} size={20} />
      ) : null}
      <span className={className} title={viewer.orgName}>
        {viewer.orgName}
      </span>
    </span>
  )
}

/** The account control, which knows the Role and the address it signs out. */
async function Account() {
  const viewer = await currentViewer()
  return viewer ? <AccountMenu viewer={viewer} /> : null
}

/**
 * The content column: the subscription notice, then the page.
 *
 * The page is inside this boundary rather than beside it because every page
 * under here reads the session too — one boundary covers all of them, and the
 * frame around it is what prerenders.
 */
async function Content({ children }: { children: ReactNode }) {
  const viewer = await currentViewer()
  if (!viewer) return <WithoutOrg />

  return (
    <>
      {/* Ticket 48: an Org whose subscription is not active is told so, on
          every page, rather than shown a dashboard that quietly means less
          than it looks like it does. No subscription row is the same answer
          as an inactive one — it is the state every Org starts in, and the
          commonest reason a person is reading this notice. Collection keeps
          working either way: refusing the Org's own history would be a worse
          answer than saying what is true. */}
      {viewer.subscriptionStatus === 'active' ? null : (
        <Inactive status={viewer.subscriptionStatus ?? 'inactive'} />
      )}
      {children}
    </>
  )
}

/** A line of the frame's own colour, where a name has not arrived yet. */
function Pending({ className }: { className: string }) {
  return (
    <span
      className={`bg-surface-hover inline-block h-3 w-24 animate-none rounded ${className}`}
      aria-hidden="true"
    />
  )
}

/**
 * The Admin panel entry, for the operator and for nobody else (ticket 85).
 *
 * The flag comes from `currentOperator()`, which asks
 * `sessclone_is_platform_admin()` — the same function every policy on `rates`,
 * `tiers` and `subscriptions` asks. So this link and the `/admin` layout's own
 * gate are one rule read twice, and hiding the link is a convenience rather
 * than the refusal: a reader who types the path still meets `notFound()`.
 */
async function AdminEntry() {
  const operator = await currentOperator()
  if (!operator) return null
  return <SidebarLinks items={ADMIN_ONLY} />
}

/** The brand line at both widths: the sessclone mark, then the Org's name in
 * small capitals (Direction A, ticket 111). */
const BRAND =
  'text-text-muted flex min-w-0 items-center gap-2 text-caption tracking-[0.1em] uppercase lg:mx-2 lg:mb-2'

/** Built once at module load rather than per render of the frame. */
const GROUPS = navGroups()
const ADMIN_ONLY = [ADMIN_PANEL]
/**
 * What More stands in for, so the bar marks it when the reader is on one of
 * them. The admin entry is in this list unconditionally: the bar is part of
 * the prerendered shell, so it cannot read the flag — and marking More on
 * `/admin` is right for the one reader who can reach `/admin` at all.
 */
const BEHIND_MORE = { [MORE.href]: moreItems(true) }

// The fallbacks as values rather than as inline elements: one element each,
// created once, rather than a new one on every render of the frame.
const PENDING_SIDEBAR = <Pending className="mt-1" />
const PENDING_HEADER = <Pending className="" />
const PENDING_CONTENT = <Loading />
// The navigation reads `usePathname()` to mark the current destination, and on
// a route with a dynamic segment that value only exists at runtime — so these
// two boundaries are what let `/sessions/[sessionId]`, `/turns/[id]` and
// `/costs/[dimension]/[id]` prerender a shell at all. The fallback is the same
// navigation with nothing marked, which is navigation a reader can already
// use. On a static route the boundary resolves during the build, so those
// shells carry the mark exactly as before.
const PENDING_GROUPS = <SidebarGroupsPending groups={GROUPS} />
const PENDING_BAR = <BottomBarLinksPending items={BOTTOM_BAR} />

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-ground text-text min-h-dvh lg:flex">
      {/* Desktop: the 232px sidebar, holding the same destinations and the
          account block. Sticky at the window's height, so the groups stay put
          while a long page scrolls beside them (Direction A, ticket 111). */}
      <aside
        // 232px, which is what the wireframes draw at 1440.
        className="border-rule hidden w-[232px] shrink-0 flex-col justify-between overflow-y-auto border-r px-3.5 py-[18px] lg:sticky lg:top-0 lg:flex lg:h-dvh"
      >
        <div>
          <p className={BRAND}>
            <LogoMark className="text-text" />
            <Suspense fallback={PENDING_SIDEBAR}>
              <OrgName className="block truncate" />
            </Suspense>
          </p>
          <nav aria-label="Main" className="mt-2">
            <Suspense fallback={PENDING_GROUPS}>
              <SidebarGroups groups={GROUPS}>
                {/* The one entry that is a database read. Its fallback is
                  nothing: an entry that appeared and then vanished would be
                  worse than one that arrives a moment late. */}
                <Suspense fallback={null}>
                  <AdminEntry />
                </Suspense>
              </SidebarGroups>
            </Suspense>
          </nav>
        </div>
        {/* The account block, and the credit under it — which is where the
            wireframes put the self-hosting credit at 1440. It is shown on
            every deployment rather than only a self-hosted one, because the
            additional term in `NOTICE.md` makes no such distinction. */}
        <div className="flex flex-col gap-4">
          <Suspense fallback={null}>
            <Account />
          </Suspense>
          <PanelCredit />
        </div>
      </aside>

      {/* Phone: the header carries the Org name and the account control, and
          the four destinations are a bottom bar. */}
      <header className="border-rule bg-ground sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-1.5 lg:hidden">
        <p className={BRAND}>
          <LogoMark className="text-text" />
          <Suspense fallback={PENDING_HEADER}>
            <OrgName className="block truncate" />
          </Suspense>
        </p>
        <Suspense fallback={null}>
          <Account />
        </Suspense>
      </header>

      {/* Keeps the painted theme and accent on the database's: repaints an
          open page after a save, and corrects a cookie that has fallen behind
          (somebody else changed the Org's colour). Inside a boundary of its
          own so it never delays the frame or the page. */}
      <Suspense fallback={null}>
        <AppearanceSync />
      </Suspense>

      {/* The bottom bar is fixed, so the content column reserves room for it
          rather than ending underneath it. */}
      <main className="min-w-0 grow px-4 py-5 pb-28 lg:px-7 lg:pb-8">
        <Suspense fallback={PENDING_CONTENT}>
          <Content>{children}</Content>
        </Suspense>
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
        <Suspense fallback={PENDING_BAR}>
          <BottomBarLinks items={BOTTOM_BAR} behind={BEHIND_MORE} />
        </Suspense>
      </nav>
    </div>
  )
}
