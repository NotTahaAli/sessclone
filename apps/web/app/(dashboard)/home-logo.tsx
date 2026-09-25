import Link from 'next/link'

import { siteFlags, siteLinks } from '../../lib/site-flags'
import { LogoMark } from '../_ui/logo'

/**
 * The sessclone mark in the dashboard's brand line, as the way to the landing
 * page (ticket 138), or to Costs where this deployment has none. The Proxy
 * lets a click from here reach the landing page, where a typed `/` would open
 * the dashboard instead.
 *
 * Not prefetched: the mark is on every dashboard page, and a prefetch of `/`
 * from each is a landing-page render nobody asked for.
 */
export function HomeLogo() {
  const { logo } = siteLinks(siteFlags())
  return (
    <Link
      href={logo.href}
      prefetch={false}
      aria-label={logo.label}
      className="hover:bg-surface-hover -m-1 shrink-0 rounded p-1"
    >
      <LogoMark className="text-text" />
    </Link>
  )
}
