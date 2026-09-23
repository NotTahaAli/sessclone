import Link from 'next/link'
import type { ReactNode } from 'react'

import { buttonClass } from '../_ui/primitives'

// EmptyState, from the design system's inventory: a headline, one sentence,
// and a primary action. Ticket 45 needs it for the state a brand-new Org sees
// before any Turn arrives; `docs/design/product-ia.md` holds the sentence for
// every other surface that can be empty on day one, and each of those is this
// component with different words rather than a component of its own.
//
// The neutral tokens throughout, never a status colour. An empty surface on
// day one is an ordinary state — the product working exactly as it should
// before anything has been collected — and painting it amber says something
// went wrong.

export function EmptyState({
  headline,
  children,
  action,
}: {
  headline: string
  /** One sentence. Anything longer belongs on the surface, not in here. */
  children: ReactNode
  /** Where the reader goes next, as data rather than as markup: the product
   * IA gives every empty state at most one action, and every one of them
   * navigates. */
  action?: { href: string; label: string }
}) {
  return (
    // Direction A (ticket 112): no box. The headline, the sentence and the
    // one action, centred in the space the rows would take; the action is
    // the text-filled primary button, never the accent.
    <div className="px-4 py-12 text-center">
      <h2 className="text-heading">{headline}</h2>
      <p className="text-text-muted mx-auto mt-1.5 max-w-prose text-body">
        {children}
      </p>
      {action ? (
        <div className="mt-5">
          <Link href={action.href} className={buttonClass('primary')}>
            {action.label}
          </Link>
        </div>
      ) : null}
    </div>
  )
}
