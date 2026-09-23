import Link from 'next/link'
import { SignedInLink } from './signed-in-link'
import { Lockup } from '../_ui/logo'
import type { ReactNode } from 'react'

import { CONTACT_EMAIL, REPOSITORY } from './constants'

// MarketingFrame. Nav, footer, repository link — the two public pages hang
// from it, and both themes and every width are its job rather than each
// page's. The site shares every control and every colour token with the
// dashboard and adds one display step: a serif face for headlines.
//
// The accent is always Clay here: a signed-out visitor has no Org and so no
// seed to apply, which is what `globals.css` already defaults to. Light and
// dark still follow the visitor's own preference.
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-rule border-b">
        <nav className="mx-auto flex h-16 w-full max-w-[1120px] items-center justify-between gap-4 px-5">
          <Link
            href="/"
            className="text-heading flex h-[var(--control-h)] items-center"
            aria-label="sessclone home"
          >
            <Lockup />
          </Link>
          <div className="text-body flex items-center gap-5">
            <Link
              href="/pricing"
              className="hover:text-accent-text flex h-[var(--control-h)] items-center"
            >
              Pricing
            </Link>
            <a
              href={REPOSITORY}
              className="hover:text-accent-text flex h-[var(--control-h)] items-center"
            >
              Repository
            </a>
            <SignedInLink variant="header" />
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-rule border-t">
        <div className="text-caption text-text-muted mx-auto flex w-full max-w-[1120px] flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p>
            sessclone — Claude Code usage and cost, for a whole team.
            Self-hostable, free at any size.
          </p>
          <div className="flex flex-wrap gap-5">
            <Link
              href="/pricing"
              className="hover:text-accent-text flex h-[var(--control-h)] items-center"
            >
              Pricing
            </Link>
            <a
              href={REPOSITORY}
              className="hover:text-accent-text flex h-[var(--control-h)] items-center"
            >
              Repository
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="hover:text-accent-text flex h-[var(--control-h)] items-center"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
