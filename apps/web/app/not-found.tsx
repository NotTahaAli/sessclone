import type { Metadata } from 'next'

import { siteFlags, siteLinks } from '../lib/site-flags'
import MarketingLayout from './(marketing)/layout'
import { FRAME } from './(marketing)/constants'
import { Row, SectionBreak, cardClass } from './_ui/primitives'
import { RequestedPath } from './requested-path'

// Every unknown address, signed in or out (Taha, 2026-09-28, option "C · Log"
// of three): the marketing frame, the request as one log line, and rows to
// the pages that do exist. Next adds `noindex` and answers 404 on its own.

export const metadata: Metadata = { title: 'Page not found' }

export default function NotFound() {
  const { docs, pricing } = siteLinks(siteFlags())
  return (
    <MarketingLayout>
      <section className={`${FRAME} pt-12 pb-24 lg:pt-24 lg:pb-32`}>
        <div className="max-w-[560px]">
          <p
            className={`${cardClass} grid grid-cols-[auto_1fr_auto] gap-3 rounded-xl font-mono text-[13px]`}
          >
            <span className="text-text-muted">GET</span>
            <span className="truncate">
              <RequestedPath />
            </span>
            <span className="text-accent-text">404</span>
          </p>
          <h1 className="text-heading-lg mt-6">
            Nothing is filed at this address.
          </h1>
          <p className="text-text-muted mt-1 text-body">
            The link may be old, or the address mistyped.
          </p>
          <SectionBreak>Try</SectionBreak>
          <ul>
            <li>
              <Row name="Home" meta="/" href="/" />
            </li>
            <li>
              <Row name="Docs" meta="/docs" href={docs()} />
            </li>
            {pricing ? (
              <li>
                <Row name="Pricing" meta={pricing} href={pricing} />
              </li>
            ) : null}
            <li>
              <Row name="Sign in" meta="/sign-in" href="/sign-in" />
            </li>
          </ul>
        </div>
      </section>
    </MarketingLayout>
  )
}
