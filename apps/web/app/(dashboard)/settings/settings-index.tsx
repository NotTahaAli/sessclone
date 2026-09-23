'use client'

import { usePathname } from 'next/navigation'

import { PageHeader } from '../page-header'
import type { SettingsItem } from '../navigation'
import { Row } from '../../_ui/primitives'

// Ticket 113: the settings index, as a column. On desktop it stays on the left
// with the open page beside it, its row filled; on a phone it is the Settings
// page itself and each row opens its page, which carries a ‹ back to here.
//
// A client component for one reason: which row is open is the path, and the
// layout that renders this is not re-rendered on navigation. `usePathname` is
// Next's own answer for marking the current link (layout docs, "active
// navigation links").

export function SettingsIndex({
  items,
  you,
  org,
}: {
  items: SettingsItem[]
  /** The values on the You and Org rows' right: your name, the Org's. */
  you: string
  org: string
}) {
  const pathname = usePathname()
  const home = pathname === '/settings'
  // The longest href the path starts with is the open one, so Members is
  // open on its page rather than Org, whose path it extends.
  const open = items
    .filter(
      (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .toSorted((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <nav
      aria-label="Settings"
      className={home ? 'lg:pr-6' : 'hidden lg:block lg:pr-6'}
    >
      {home ? (
        <div className="lg:hidden">
          <PageHeader title="Settings" />
        </div>
      ) : null}
      <ol className="mt-2">
        {items.map((item) => (
          <li key={item.href}>
            <Row
              href={item.href}
              selected={item.href === open}
              name={item.label}
              meta={
                item.href === '/settings/you'
                  ? you
                  : item.href === '/settings/org'
                    ? org
                    : undefined
              }
              sub={item.about}
            />
          </li>
        ))}
      </ol>
    </nav>
  )
}
