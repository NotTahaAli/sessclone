import { Suspense } from 'react'

import { demoEnabled } from '../../lib/demo'
import { realSessionUser } from '../../lib/supabase/server'
import { buttonClass } from '../_ui/primitives'

/**
 * "Try the demo" (ticket 137), or nothing on a deployment without one.
 * A plain anchor: `/demo` sets a cookie, which a prefetch must not do, and
 * `nofollow` keeps crawlers out of the made-up dashboard.
 *
 * Hidden from anyone signed in (Taha, 2026-09-25): a real session wins over
 * the demo cookie, so for them `/demo` only opened their own dashboard. The
 * prerendered shell carries nothing, and the link appears once the session
 * read finds nobody signed in: never a link a signed-in reader could click.
 * The shell holds its place with an invisible copy, no link and unread, so
 * the buttons beside it do not rewrap when it lands (a 0.106 layout shift on
 * a phone, 2026-10-01); only a signed-in reader sees the space close.
 * `block` puts it on its own line, as the pricing intro wants, without leaving
 * an empty line behind when it is hidden.
 */
export function DemoLink({ block = false }: { block?: boolean }) {
  if (!demoEnabled()) return null
  return (
    <Suspense fallback={block ? BLOCK_PLACEHOLDER : PLACEHOLDER}>
      <DemoLinkResolved block={block} />
    </Suspense>
  )
}

/** The link once the session is read; exported for its test. */
export async function DemoLinkResolved({ block = false }: { block?: boolean }) {
  if (await realSessionUser()) return null
  return block ? BLOCK : INLINE
}

const INLINE = (
  // oxlint-disable-next-line next/no-html-link-for-pages -- a Route Handler that sets a cookie: never prefetched.
  <a
    href="/demo"
    rel="nofollow"
    className={`${buttonClass()} h-10 px-4 text-[14px]`}
  >
    Try the demo
  </a>
)
const BLOCK = <p className="mb-4">{INLINE}</p>

const PLACEHOLDER = (
  <span
    aria-hidden="true"
    className={`${buttonClass()} invisible h-10 px-4 text-[14px]`}
  >
    Try the demo
  </span>
)
const BLOCK_PLACEHOLDER = <p className="mb-4">{PLACEHOLDER}</p>
