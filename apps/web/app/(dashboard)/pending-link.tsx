'use client'

import Link from 'next/link'
import { useLinkStatus } from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

// What a click looks like before the next page arrives.
//
// A route under this shell reads the database on the viewer's own connection,
// and from a serverless instance to a managed Postgres that is a second or
// two on a cold one. `loading.tsx` covers the content column once the
// navigation has started, but the click itself had nothing: the item the
// person pressed looked exactly as it did before, so the honest reading was
// that the click had missed.
//
// `useLinkStatus` is Next's hook for that gap, and has to be called from a
// descendant of the `Link` it reports on — hence a component inside, rather
// than a flag on the outside.

/** Dims what was clicked until its page arrives. Nothing moves. */
function Pending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus()

  return (
    <span
      // Opacity rather than a spinner or an inserted element: the design
      // system's loading rule is blocks in place and no layout shift, and an
      // indicator that appears on click shifts whatever is beside it. An
      // inline span around the label changes no layout either — and it has to
      // be a real box, since `display: contents` has nothing to fade.
      className={pending ? 'opacity-50' : undefined}
    >
      {children}
      {/* Announced once, when it becomes true, for a reader who cannot see
          the dimming. */}
      <span role="status" className="sr-only">
        {pending ? 'Loading' : ''}
      </span>
    </span>
  )
}

/**
 * A `Link` that dims itself while its page is on the way.
 *
 * Everything else is `Link`'s own API, so a caller passes `href`,
 * `className` and `aria-current` exactly as before.
 */
export function PendingLink({
  children,
  ...rest
}: ComponentProps<typeof Link>) {
  return (
    <Link {...rest}>
      <Pending>{children}</Pending>
    </Link>
  )
}
