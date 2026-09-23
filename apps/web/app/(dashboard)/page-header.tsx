import Link from 'next/link'
import type { ReactNode } from 'react'

// PageHeader, Direction A (ticket 111): the page's title at 20px with its
// header pills on the right, over a hairline. The description stays for the
// pages ticket 112 has not rebuilt; the approved design has none, so a
// rebuilt page drops it.

export function PageHeader({
  title,
  description,
  actions,
  back,
  children,
}: {
  title?: string
  description?: string
  /** Where the phone's ‹ goes (ticket 113): a settings page's way back to
   * the index, which desktop shows in the column beside it instead. */
  back?: string
  /** Pills and buttons on the title's line: `PillMenu`, `Pill`, `Button`. */
  actions?: ReactNode
  /** The heading's content when it is more than a string — since tickets 90
   * and 91, the surfaces whose subject can be renamed put the pencil inside
   * the heading, beside the name, rather than in a form further down. */
  children?: ReactNode
}) {
  return (
    <header className="border-rule border-b pb-3.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        {back ? (
          <Link
            href={back}
            aria-label="Back"
            className="text-text-muted -mr-1 text-heading-lg leading-none lg:hidden"
          >
            ‹
          </Link>
        ) : null}
        {/* A page with a way back sits in the settings column on desktop,
            under the "Settings" title, so it takes the column's heading
            size there rather than a second 20px title. */}
        <h1
          className={`grow ${back ? 'text-heading-lg lg:text-heading' : 'text-heading-lg'}`}
        >
          {children ?? title}
        </h1>
        {actions}
      </div>
      {description ? (
        <p className="text-text-muted mt-1 text-body">{description}</p>
      ) : null}
    </header>
  )
}
