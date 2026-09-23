import Link from 'next/link'
import type { ReactNode } from 'react'

import { StatusGlyph } from '../_ui/primitives'

// Ticket 112: the transcript viewer's Finder columns, for the dashboard's
// lists. On desktop a row opens its detail in a column on the right and the
// list stays where it is; on a phone the same link shows the detail in the
// list's place, with a back chevron, so the row opens a page.
//
// One link for both widths. The open row lives in the URL (`?open=…`), so it
// is a real navigation — back undoes it, it can be sent — and CSS decides
// which of the two layouts draws it. No listener, nothing to clean up.

export function Finder({
  column,
  children,
}: {
  /** The open row's detail, or nothing when no row is open. Passed as a
   * `FinderColumn` child rather than a prop: no element in a prop. */
  column: boolean
  /** The list, then the `FinderColumn` when `column`. */
  children: ReactNode
}) {
  return (
    <div className={column ? 'lg:flex lg:items-stretch' : 'min-w-0'}>
      {children}
    </div>
  )
}

/** The list: in the list's place on a phone until a row opens, then hidden. */
export function FinderList({
  column,
  children,
}: {
  column: boolean
  children: ReactNode
}) {
  return column ? (
    <div className="hidden min-w-0 flex-1 lg:block lg:pr-6">{children}</div>
  ) : (
    children
  )
}

export function FinderColumn({ children }: { children: ReactNode }) {
  return (
    <section className="lg:border-rule min-w-0 lg:w-[440px] lg:shrink-0 lg:border-l lg:pl-6">
      {children}
    </section>
  )
}

/**
 * A column's head: the name, a ✕ that closes it on desktop, and a ‹ that goes
 * back to the list on a phone. Both are the same link: the list without the
 * open row.
 */
export function ColumnHead({
  children,
  glyph,
  closeHref,
  sub,
}: {
  /** The title. */
  children: ReactNode
  glyph?: 'live' | 'ok' | 'idle'
  closeHref: string
  sub?: ReactNode
}) {
  return (
    <div className="pt-3.5 pb-1.5">
      <div className="flex min-w-0 items-center gap-2 font-semibold">
        <Link
          href={closeHref}
          aria-label="Back to the list"
          className="text-text-muted -ml-1 px-1 text-heading-lg leading-none font-normal lg:hidden"
        >
          ‹
        </Link>
        {glyph ? <StatusGlyph state={glyph} /> : null}
        <h2 className="min-w-0 truncate text-body font-semibold">{children}</h2>
        <Link
          href={closeHref}
          aria-label="Close this column"
          className="text-text-muted hover:text-text ml-auto hidden px-1 font-normal lg:inline"
        >
          ✕
        </Link>
      </div>
      {sub ? (
        <div className="text-text-muted mt-0.5 text-caption break-words">
          {sub}
        </div>
      ) : null}
    </div>
  )
}
