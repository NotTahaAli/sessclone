'use client'

import { usePathname } from 'next/navigation'

import type { NavItem } from './navigation'
import { PendingLink } from './pending-link'

// The only client module in the shell, and it is one because of a single
// fact: which destination is current. A layout cannot read the path on the
// server — there is no request path in a Server Component — so the active
// state is computed here, from `usePathname`, and nothing else in this module
// needs the browser.
//
// The items themselves arrive as props, already filtered by Role on the
// server. What a Role may reach is not a decision that ships to the browser.

/** `/costs` is current on `/costs?view=members`, and on nothing else. */
const isCurrent = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`)

export function SidebarLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const current = isCurrent(pathname, item.href)
        return (
          <li key={item.href}>
            <PendingLink
              href={item.href}
              aria-current={current ? 'page' : undefined}
              // An accent edge and accent text, and deliberately no fill: the
              // design system says the active item carries an underline rather
              // than a fill, because the accent fill is the one primary action
              // on a surface and a filled nav item competes with it. Dark is
              // where that matters most — `--accent-subtle` there is a deep
              // saturated brown, and a nav item painted in it reads as the
              // loudest thing on the page.
              className={`hover:bg-surface-hover flex h-[var(--control-h)] items-center rounded-md border-l-2 px-3 text-body ${
                current
                  ? 'border-accent-border text-accent-text'
                  : 'text-text-secondary border-transparent'
              }`}
            >
              {item.label}
            </PendingLink>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The bar's columns follow the list rather than being fixed at four. The Org
 * navigation has four destinations and the admin area (ticket 62) has three: a
 * hard `grid-cols-4` left the admin bar's items bunched into the left three
 * quarters of a phone screen with a gap beside them, which is what the
 * screenshot showed.
 *
 * Written out as whole class names, because Tailwind reads the source rather
 * than the running page: a class built by interpolation is a class that is
 * never generated.
 */
const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
}

export function BottomBarLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <ul className={`grid ${COLUMNS[items.length] ?? 'grid-cols-4'}`}>
      {items.map((item) => {
        const current = isCurrent(pathname, item.href)
        return (
          <li key={item.href}>
            <PendingLink
              href={item.href}
              aria-current={current ? 'page' : undefined}
              // The 2px rule above the label is the same accent edge the
              // sidebar draws down the side of its item, turned through ninety
              // degrees: one idea, two widths.
              className={`flex flex-col items-center justify-center gap-1 border-t-2 py-3 text-caption ${
                current
                  ? 'border-accent-border text-accent-text'
                  : 'text-text-secondary border-transparent'
              }`}
            >
              {item.label}
            </PendingLink>
          </li>
        )
      })}
    </ul>
  )
}
