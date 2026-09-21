import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

import { DESTINATIONS, settingsFor } from '../app/(dashboard)/navigation'
import { reachesOrgSettings, reachesTier } from '../lib/viewer'

// Ticket 45's first criterion — "navigation reflecting what the signed-in Role
// may reach" — is a branch, and this is the cheapest level it can be checked
// at. The shell itself is an async Server Component, which Next's own testing
// guide says to cover end to end rather than with a unit test; the decision
// the shell makes is pure, so it lives out here where a test can reach it.

test('all four destinations are reachable by every Role', () => {
  // Deliberate, and not an oversight in the filter: what a Role sees inside
  // Costs differs, and that is the policies' answer rather than the
  // navigation's (ADR 0001).
  expect(DESTINATIONS.map((item) => item.href)).toEqual([
    '/costs',
    '/keys',
    '/devices',
    '/settings',
  ])
})

test('Org settings is listed for an Owner and an Admin', () => {
  for (const role of ['owner', 'admin'] as const) {
    expect(settingsFor(role).map((item) => item.href)).toEqual([
      '/settings/you',
      '/settings/org',
    ])
    expect(reachesOrgSettings(role)).toBe(true)
  }
})

test('Org settings is absent for a Manager and a Member, not disabled', () => {
  // Absent rather than refused: a control that cannot be used is a question
  // the reader cannot answer (`docs/design/product-ia.md`).
  for (const role of ['manager', 'member'] as const) {
    expect(settingsFor(role).map((item) => item.href)).toEqual([
      '/settings/you',
    ])
    expect(reachesOrgSettings(role)).toBe(false)
  }
})

test('the Tier page is the Owner, and not the Admin', () => {
  // `CONTEXT.md` gives an Admin the whole Org's settings and no billing.
  expect(reachesTier('owner')).toBe(true)
  expect(reachesTier('admin')).toBe(false)
})

test('every Role-gated page checks the Role on the server too', () => {
  // The nav is not a check: `/settings/org` is a typeable URL, and hiding the
  // link from a Manager leaves the surface reachable. ADR 0001 keeps the
  // *data* safe either way, because every read there will be policy-scoped;
  // what a missing guard leaks is the page.
  //
  // A file read, for the reason `panel-credit.test.ts` gives: the page is an
  // async Server Component, and the thing worth proving is that the guard is
  // in the file at all rather than what it renders.
  const page = readFileSync(
    new URL('../app/(dashboard)/settings/org/page.tsx', import.meta.url),
    'utf8',
  )

  expect(page).toContain('reachesOrgSettings(viewer.role)')
  expect(page).toContain('notFound()')
})

test('the viewer is read once per request, not once per component', () => {
  // The shell and the page it wraps both call `currentViewer()` while
  // rendering one request. Unmemoised that is two `signedInUser()` round trips
  // and two `asViewer` transactions per navigation, each opening a `begin`, a
  // `set_config`, the select and a `commit`. React's `cache` deduplicates them
  // for the life of the request and no longer, which is the pattern Next's own
  // authentication guide gives for a function like this one.
  const viewer = readFileSync(
    new URL('../lib/viewer.ts', import.meta.url),
    'utf8',
  )

  expect(viewer).toContain("import { cache } from 'react'")
  expect(viewer).toMatch(/export const currentViewer = cache\(/)
})
