import Link from 'next/link'
import type { ReactNode } from 'react'

import { siteFlags, siteLinks } from '../../lib/site-flags'
import { Lockup } from '../_ui/logo'
import { CloudflareAnalytics } from '../cloudflare-analytics'
import { ClarityAnalytics } from './clarity'
import { CONTACT_EMAIL, FRAME, REPOSITORY } from './constants'
import { SignedInLink } from './signed-in-link'

// MarketingFrame, in Direction A (ticket 114): the dashboard's own ground,
// type and hairlines, so the product looks like its own marketing. Both
// themes, following the visitor's preference; the accent stays the Clay
// default, since a signed-out visitor has no Org and so no seed.
//
// Ticket 138: with no landing page this frame still carries the legal pages,
// so Pricing drops out of the nav and the footer; with no docs, Docs links to
// sessclone.com. Read while the frame prerenders, hence a rebuild per change.

const LINK = 'hover:text-text flex h-[var(--pill-h)] items-center'

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const { docs, pricing } = siteLinks(siteFlags())
  return (
    <div className="bg-ground text-text flex min-h-dvh flex-col">
      <header>
        <nav
          className={`${FRAME} flex items-center justify-between gap-4 py-3.5 lg:py-[18px]`}
        >
          <Link
            href="/"
            aria-label="SessClone home"
            className="flex items-center"
          >
            <Lockup />
          </Link>
          <div className="text-text-muted flex items-center gap-4 text-[13px]">
            {pricing ? (
              <Link href={pricing} className={LINK}>
                Pricing
              </Link>
            ) : null}
            <Link href={docs()} className={LINK}>
              Docs
            </Link>
            <a href={REPOSITORY} className={`${LINK} max-sm:hidden`}>
              GitHub
            </a>
            <SignedInLink variant="header" />
          </div>
        </nav>
      </header>

      <main className="min-w-0 flex-1">{children}</main>

      <footer className="border-rule border-t">
        <div
          className={`${FRAME} text-text-muted flex flex-col gap-2 py-6 text-caption sm:flex-row sm:items-center sm:justify-between`}
        >
          <p>SessClone · Claude Code usage and cost, for a whole team.</p>
          <div className="flex flex-wrap gap-x-4">
            {pricing ? (
              <Link href={pricing} className={LINK}>
                Pricing
              </Link>
            ) : null}
            <Link href={docs()} className={LINK}>
              Docs
            </Link>
            <a href={REPOSITORY} className={LINK}>
              GitHub
            </a>
            <Link href="/privacy" className={LINK}>
              Privacy
            </Link>
            <Link href="/terms" className={LINK}>
              Terms
            </Link>
            {CONTACT_EMAIL ? (
              <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
                {CONTACT_EMAIL}
              </a>
            ) : null}
          </div>
        </div>
      </footer>
      <ClarityAnalytics />
      <CloudflareAnalytics />
    </div>
  )
}
