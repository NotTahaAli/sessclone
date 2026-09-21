import Link from 'next/link'
import type { ReactNode } from 'react'

export const REPOSITORY = 'https://github.com/NotTahaAli/sessclone'

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
            className="text-heading font-semibold tracking-tight"
            aria-label="sessclone home"
          >
            sessclone
          </Link>
          <div className="text-body flex items-center gap-5">
            <Link href="/pricing" className="hover:text-accent-text">
              Pricing
            </Link>
            <a href={REPOSITORY} className="hover:text-accent-text">
              Repository
            </a>
            <Link
              href="/sign-in"
              className="bg-accent-fill text-accent-on-fill border-accent-border flex h-[var(--control-h)] items-center border px-4"
            >
              Sign in
            </Link>
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
            <Link href="/pricing" className="hover:text-accent-text">
              Pricing
            </Link>
            <a href={REPOSITORY} className="hover:text-accent-text">
              Repository
            </a>
            <a
              href="mailto:hello@sessclone.dev"
              className="hover:text-accent-text"
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
