'use client'

import { usePathname } from 'next/navigation'

import { GROUP_HEADING, NavGlyph } from './nav-glyph'
import type { NavGroup, NavItem } from './navigation'
import { PendingLink } from './pending-link'

// The only client module in the shell, and it is one because of a single
// fact: which destination is current. A layout cannot read the path on the
// server — there is no request path in a Server Component — so the active
// state is computed here, from `usePathname`, and nothing else in this module
// needs the browser.
//
// The items themselves arrive as props, already filtered on the server. What a
// Role may reach, and whether the viewer holds the platform flag, is not a
// decision that ships to the browser.

/** `/costs` is current on `/costs?view=members`, and on nothing else. */
const isCurrent = (pathname: string | null, href: string) =>
  pathname !== null && (pathname === href || pathname.startsWith(`${href}/`))

// Every list below comes in two components over one render function, and the
// pair exists for Cache Components (ticket 83).
//
// `usePathname()` is a runtime value, so a route with a dynamic segment —
// `/sessions/[sessionId]`, `/turns/[id]`, `/costs/[dimension]/[id]` — cannot
// prerender a component that reads it, and Next refuses the build rather than
// shipping a shell that waits. The fix Next itself names is a Suspense
// boundary, and a boundary needs a fallback worth showing: this one is the
// same navigation with nothing marked, which is the navigation a reader can
// already use while the mark streams in. A spinner or a blank would be the
// frame disappearing on exactly the pages reached by clicking a row.
//
// On a static route the boundary resolves during the build, so those shells
// carry the marked navigation exactly as before and `check-shells.mjs` still
// passes.

/**
 * One group's links. Groups arrive as a list and each renders its own list,
 * so a heading always has its items under it rather than beside them.
 */
type Groups = {
  groups: NavGroup[]
  /**
   * Appended to the last group (ticket 85). The admin entry is the one item
   * that depends on a database read, and the shell above prerenders (ticket
   * 83) — so it streams in there rather than making the whole frame wait for
   * a flag that is false for almost everybody.
   */
  children?: React.ReactNode
}

const groupsMarkup = (
  { groups, children }: Groups,
  pathname: string | null,
) => (
  <div className="flex flex-col">
    {groups.map((group, index) => (
      <div key={group.label} className="flex flex-col">
        <p className={GROUP_HEADING}>{group.label}</p>
        {linksMarkup(group.items, pathname)}
        {index === groups.length - 1 ? children : null}
      </div>
    ))}
  </div>
)

export function SidebarGroups(props: Groups) {
  return groupsMarkup(props, usePathname())
}

/** The same groups with nothing marked: the Suspense fallback. */
export function SidebarGroupsPending(props: Groups) {
  return groupsMarkup(props, null)
}

export function SidebarLinks({ items }: { items: NavItem[] }) {
  return linksMarkup(items, usePathname())
}

const linksMarkup = (items: NavItem[], pathname: string | null) => {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const current = isCurrent(pathname, item.href)
        return (
          <li key={item.href}>
            <PendingLink
              href={item.href}
              aria-current={current ? 'page' : undefined}
              // Direction A (ticket 111): the current item takes the neutral
              // `selected` fill and the text colour, and no accent at all —
              // the accent is kept for live state, as on the transcript page.
              className={`flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-body ${
                current
                  ? 'bg-selected text-text font-medium'
                  : 'text-text-muted hover:bg-surface-hover hover:text-text'
              }`}
            >
              <NavGlyph icon={item.icon} />
              {item.label}
              {item.badge ? (
                <span className="border-rule text-text-secondary ml-auto rounded-full border px-2 text-caption">
                  {item.badge}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null}
            </PendingLink>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The bar's columns follow the list rather than being fixed at four. The Org
 * navigation has four entries — three destinations and More (ticket 85) — and
 * the admin area (ticket 62) has three: a hard `grid-cols-4` left the admin
 * bar's items bunched into the left three quarters of a phone screen with a
 * gap beside them, which is what the screenshot showed.
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

type Bar = {
  items: NavItem[]
  /**
   * The destinations one of these entries stands in for — the More entry's
   * own, on the Org bar (ticket 85). Without it a reader on Devices sees
   * nothing marked at all, which reads as having navigated out of the product.
   *
   * Keyed by href so the bar stays a plain list: the entry that has a `behind`
   * list is current when the reader is on any of them.
   */
  behind?: Record<string, NavItem[]>
}

export function BottomBarLinks(props: Bar) {
  return barMarkup(props, usePathname())
}

/** The same bar with nothing marked: the Suspense fallback. */
export function BottomBarLinksPending(props: Bar) {
  return barMarkup(props, null)
}

const barMarkup = ({ items, behind }: Bar, pathname: string | null) => {
  return (
    <ul className={`grid ${COLUMNS[items.length] ?? 'grid-cols-4'}`}>
      {items.map((item) => {
        const current =
          isCurrent(pathname, item.href) ||
          (behind?.[item.href] ?? []).some((hidden) =>
            isCurrent(pathname, hidden.href),
          )
        return (
          <li key={item.href}>
            <PendingLink
              href={item.href}
              aria-current={current ? 'page' : undefined}
              // A 2px rule in the text colour above the current label, and no
              // accent: the accent is for live state (Direction A, ticket
              // 111). The bottom padding clears a phone's home indicator.
              // The icon above a small label (2026-09-23).
              className={`flex flex-col items-center justify-center gap-1 pt-2.5 pb-[max(14px,env(safe-area-inset-bottom))] text-[11px] ${
                current
                  ? 'text-text font-medium shadow-[inset_0_2px_0_var(--color-text)]'
                  : 'text-text-muted'
              }`}
            >
              <NavGlyph icon={item.icon} />
              {item.label}
            </PendingLink>
          </li>
        )
      })}
    </ul>
  )
}
