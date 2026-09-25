import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import { PlanStep } from '../app/new-org/page'

// The page's imports reach the session and the database; neither is read by
// the part under test.
vi.mock('../app/(dashboard)/org-actions', () => ({ createOrg: () => null }))
vi.mock('../lib/supabase/server', () => ({ realSessionUser: async () => null }))
vi.mock('../app/sign-up/plan-choices', () => ({
  offeredPlans: async () => [],
  PlanChoices: () => null,
}))

const NO_TIERS: never[] = []

test('with no Tier to offer, a notice and no form that can only refuse', () => {
  const html = renderToStaticMarkup(<PlanStep tiers={NO_TIERS} />)
  expect(html).toContain('Plans cannot be loaded right now')
  expect(html).not.toContain('<form')
})
