import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { ADMIN_DESTINATIONS } from './navigation'
import { PanelCredit } from '../(dashboard)/credit'
import { BottomBarLinks, SidebarLinks } from '../(dashboard)/nav-links'
import { currentOperator } from '../../lib/platform-admin'

// Ticket 62: the operator's frame, built once so the admin pages that follow
// (63, 64, 65) share it.
//
// The gate is here rather than on each page, which is what makes it hold for a
// page added later: a route under `/admin` is refused by existing, not by
// remembering to check. And it is `notFound` rather than a refusal message,
// because a message confirms the area exists — an Org Owner probing `/admin`
// learns nothing they did not already know.
//
// Routing is the second lock, never the first. `sessclone_is_platform_admin()`
// is what this reads and what the policies on `rates`, `tiers`,
// `subscriptions` and `org_rate_overrides` ask independently, so an operator
// page that forgot its gate would still be handed no rows (ADR 0001, proven by
// ticket 44's suite).
//
// The shape is the dashboard's, and the link components are literally the
// dashboard's — 232px sidebar at desktop, a bottom bar at phone width, one set
// of destinations in one order at both. The frame is deliberately *not* the
// Org shell: no Org name, no account switcher, nothing that implies the person
// is looking at one Org's numbers.

export default async function AdminLayout({
  children,
}: {
  children: ReactNode
}) {
  const operator = await currentOperator()
  if (!operator) notFound()

  return (
    <div className="bg-ground text-text min-h-dvh lg:flex">
      <aside className="border-rule hidden w-[232px] shrink-0 flex-col justify-between border-r p-4 lg:flex">
        <div>
          <p className="text-label text-text-muted uppercase">sessclone</p>
          <p className="text-heading mt-1">Platform</p>
          <nav aria-label="Platform administration" className="mt-6">
            <SidebarLinks items={ADMIN_DESTINATIONS} />
          </nav>
        </div>
        {/* Who is operating, so a deployment with more than one operator can
            tell from the frame which account is acting — and the licence's
            Appropriate Legal Notices under it (ticket 79). The admin area is a
            signed-in surface like any other, so it carries them for the same
            reason: by being a page inside a frame that renders them, rather
            than by remembering to. */}
        <div className="flex flex-col gap-4">
          <p
            className="text-text-muted truncate text-caption"
            title={operator.email}
          >
            {operator.email}
          </p>
          <PanelCredit />
        </div>
      </aside>

      <header className="border-rule bg-ground sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-2 lg:hidden">
        <p className="truncate">
          <span className="text-label text-text-muted block uppercase">
            sessclone
          </span>
          <span className="text-heading block truncate">Platform</span>
        </p>
        <span className="text-text-muted truncate text-caption">
          {operator.email}
        </span>
      </header>

      <main className="grow px-4 py-6 pb-28 lg:px-8 lg:pb-8">
        {children}
        {/* At phone width the sidebar is not rendered at all, so the notices
            go under the content instead. One of the two is visible at a
            time. */}
        <div className="lg:hidden">
          <PanelCredit />
        </div>
      </main>

      <nav
        aria-label="Platform administration"
        className="border-rule bg-ground fixed inset-x-0 bottom-0 z-10 border-t lg:hidden"
      >
        <BottomBarLinks items={ADMIN_DESTINATIONS} />
      </nav>
    </div>
  )
}
