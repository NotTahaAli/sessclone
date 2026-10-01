import Link from 'next/link'

import { siteFlags, siteLinks } from '../../lib/site-flags'
import { LogoMark } from './logo'

/**
 * The mark atop sign-in and sign-up. Where this deployment has a landing
 * page it links there, so a visitor who arrived from a pricing link or an
 * email has a way back that is not the browser's. Without one, `/` is only
 * a redirect back here, so the mark stays a picture.
 */
export function AuthLogo() {
  const mark = <LogoMark size={28} className="text-text" />
  const flags = siteFlags()
  if (!flags.landing) return <div className="mb-4">{mark}</div>
  const { logo } = siteLinks(flags)
  return (
    // Not prefetched, like the dashboard's mark: most visitors here are
    // signing in, not going back.
    <Link
      href={logo.href}
      prefetch={false}
      aria-label={logo.label}
      className="hover:bg-surface-hover -m-1 mb-3 self-start rounded p-1"
    >
      {mark}
    </Link>
  )
}
