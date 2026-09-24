import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, test, vi } from 'vitest'

import { PlanPicker, type Plan } from '../app/(marketing)/pricing/plan-picker'

// 2026-09-23 review: Enterprise's "Talk to us" linked the upstream project's
// GitHub issues when a deployment set no contact address — a self-hosted copy
// sending its visitors to somebody else. With no address there is no CTA.

const enterprise: Plan = {
  key: 'enterprise',
  name: 'Enterprise',
  description: 'For large teams.',
  lines: [],
  includedSeats: 0,
  basePriceUsd: null,
  seatPriceUsd: null,
  minSeats: null,
  maxSeats: null,
}

const PLANS = [enterprise]
const ROWS: never[] = []

const render = () =>
  renderToStaticMarkup(
    <PlanPicker plans={PLANS} rows={ROWS}>
      {null}
    </PlanPicker>,
  )

afterEach(() => {
  vi.unstubAllEnvs()
})

test('"Talk to us" mails the deployment’s address, and is absent without one', () => {
  vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', 'sales@example.com')
  expect(render()).toContain('mailto:sales@example.com')

  vi.stubEnv('NEXT_PUBLIC_CONTACT_EMAIL', '')
  const html = render()
  // The price column still reads "Talk to us" (`priceFor`); the link is what
  // goes.
  expect(html).not.toMatch(/>Talk to us<\/a>/)
  expect(html).not.toContain('/issues')
})
