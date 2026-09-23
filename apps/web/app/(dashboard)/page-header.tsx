import type { ReactNode } from 'react'

// PageHeader, Direction A (ticket 111): the page's title at 20px with its
// header pills on the right, over a hairline. The description stays for the
// pages ticket 112 has not rebuilt; the approved design has none, so a
// rebuilt page drops it.

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title?: string
  description?: string
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
        <h1 className="text-heading-lg grow">{children ?? title}</h1>
        {actions}
      </div>
      {description ? (
        <p className="text-text-muted mt-1 text-body">{description}</p>
      ) : null}
    </header>
  )
}
