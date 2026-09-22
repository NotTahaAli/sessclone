import { readFileSync, readdirSync } from 'node:fs'

import { expect, test } from 'vitest'

import { ADMIN_DESTINATIONS } from '../app/admin/navigation'
import { DESTINATIONS, settingsFor } from '../app/(dashboard)/navigation'
import {
  reachesOrgSettings,
  reachesTeamTranscripts,
  reachesTier,
} from '../lib/viewer'

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
      '/settings/transcripts',
      '/settings/org',
    ])
    expect(reachesOrgSettings(role)).toBe(true)
  }
})

test('Org settings is absent for a Manager and a Member, not disabled', () => {
  // Absent rather than refused: a control that cannot be used is a question
  // the reader cannot answer (`docs/design/product-ia.md`).
  for (const role of ['manager', 'member'] as const) {
    expect(reachesOrgSettings(role)).toBe(false)
  }
  expect(settingsFor('member').map((item) => item.href)).toEqual([
    '/settings/you',
  ])
})

test('Team transcripts is listed for a Manager and absent for a Member', () => {
  // Ticket 84. A Manager is in because their Scope is what the listing is
  // for; a Member's own transcripts are on Your settings, and a second page
  // showing the same rows under another name only asks which is the real one.
  expect(settingsFor('manager').map((item) => item.href)).toEqual([
    '/settings/you',
    '/settings/transcripts',
  ])
  expect(reachesTeamTranscripts('manager')).toBe(true)
  expect(reachesTeamTranscripts('member')).toBe(false)
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

// Ticket 62: the operator's area, which is not reached from any of the four
// destinations above and is gated on a flag rather than on a Role.

test('the admin area has its own destinations, not the Org ones', () => {
  // `docs/design/product-ia.md`: the admin area "does not reuse the Org
  // navigation, because the subjects are different". The components are
  // shared; the list is not, and no Org destination may appear in it.
  expect(ADMIN_DESTINATIONS.map((item) => item.href)).toEqual([
    '/admin/rates',
    '/admin/tiers',
    '/admin/orgs',
  ])

  const orgHrefs = new Set(DESTINATIONS.map((item) => item.href))
  for (const item of ADMIN_DESTINATIONS)
    expect(orgHrefs.has(item.href)).toBe(false)
})

test('nothing in the signed-in navigation ever leads to the admin area', () => {
  // The practical rule the product IA states: an Org Role, however senior,
  // never sees a way in. A `/admin` entry appearing in either list — even one
  // filtered by Role — would be that rule broken, since no Role grants the
  // flag.
  const everyEntry = [
    ...DESTINATIONS,
    ...(['owner', 'admin', 'manager', 'member'] as const).flatMap(settingsFor),
  ]

  expect(everyEntry.some((item) => item.href.startsWith('/admin'))).toBe(false)
})

test('the admin gate is on the layout, so a page added later is refused by existing', () => {
  // A file read: the layout is an async Server Component, and what is worth
  // proving here is that the guard is in the file that wraps every route under
  // `/admin` rather than on each page, where the next ticket would have to
  // remember it. Whether the guard *guards* is `platform-admin.test.ts`,
  // against the real database — a grep cannot tell `if (operator)` from
  // `if (!operator)`.
  const layout = readFileSync(
    new URL('../app/admin/layout.tsx', import.meta.url),
    'utf8',
  )

  expect(layout).toContain('currentOperator()')
  expect(layout).toContain('notFound()')

  // And no *page* under `/admin` carries its own gate, which would be the same
  // rule written twice and one of them eventually wrong.
  //
  // A Server Action or a Route Handler is the opposite case and is deliberately
  // not covered by this rule: neither renders the layout, so each one carries
  // its own check. Tickets 63, 64 and 65 add the first of them.
  for (const page of [
    '../app/admin/page.tsx',
    '../app/admin/rates/page.tsx',
    '../app/admin/tiers/page.tsx',
    '../app/admin/orgs/page.tsx',
  ]) {
    const source = readFileSync(new URL(page, import.meta.url), 'utf8')
    expect(source).not.toContain('currentOperator')
  }
})

test('every write under the admin area carries its own gate', () => {
  // A layout does not render for a Server Action POST or for a Route Handler,
  // so the gate above does not cover either. The rule for those is the
  // opposite one: each carries the check itself, or it is a platform write
  // with nothing in front of it but the policy.
  //
  // Empty today — the area is three read-only pages — so this is here to fail
  // the commit that adds the first write without the line, which is the one
  // that would otherwise ship it.
  const writes = readdirSync(new URL('../app/admin/', import.meta.url), {
    withFileTypes: true,
    recursive: true,
  }).filter(
    (entry) =>
      entry.isFile() &&
      (entry.name === 'actions.ts' || entry.name === 'route.ts'),
  )

  for (const file of writes) {
    const source = readFileSync(
      new URL(`${file.parentPath}/${file.name}`, 'file:///'),
      'utf8',
    )
    expect(
      source.includes('currentOperator'),
      `${file.name} is a write under /admin with no gate of its own`,
    ).toBe(true)
  }
})

test('the operator is read from the database, not from the session', () => {
  // The routing gate and the policy gate are one rule read twice.
  // `sessclone_is_platform_admin()` is what every policy on `rates`, `tiers`
  // and `subscriptions` asks, so a page that forgot its gate is still handed
  // no rows — and a change to the policy changes what the navigation offers in
  // the same commit. A flag carried in a cookie or a claim would be neither.
  const source = readFileSync(
    new URL('../lib/platform-admin.ts', import.meta.url),
    'utf8',
  )

  expect(source).toContain('sessclone_is_platform_admin()')
  expect(source).toContain('cache(')
})
