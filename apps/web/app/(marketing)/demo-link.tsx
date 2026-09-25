import { demoEnabled } from '../../lib/demo'
import { buttonClass } from '../_ui/primitives'

/**
 * "Try the demo" (ticket 137), or nothing on a deployment without one.
 * A plain anchor: `/demo` sets a cookie, which a prefetch must not do, and
 * `nofollow` keeps crawlers out of the made-up dashboard.
 */
export function DemoLink() {
  if (!demoEnabled()) return null
  return (
    // oxlint-disable-next-line next/no-html-link-for-pages -- a Route Handler that sets a cookie: never prefetched.
    <a
      href="/demo"
      rel="nofollow"
      className={`${buttonClass()} h-10 px-4 text-[14px]`}
    >
      Try the demo
    </a>
  )
}
