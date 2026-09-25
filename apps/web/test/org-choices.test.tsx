import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'

import { SwitcherBody } from '../app/(dashboard)/org-choices'

// The switcher's expiry line, counted in whole days from the server's clock.
// An invitation that lapsed a few hours ago is -0 days by `Math.ceil`, and
// printed as "expired 0d ago".

vi.mock('../app/(dashboard)/org-actions', () => ({
  acceptInvite: () => null,
  declineInvite: () => null,
  leaveCurrentOrg: () => null,
  switchOrg: () => null,
}))

const NOW = '2026-09-25T12:00:00Z'

const data = (expiresAt: string) => ({
  orgs: [],
  invites: [
    {
      id: 'i',
      orgName: 'Initech',
      role: 'member' as const,
      invitedBy: null,
      expiresAt,
    },
  ],
  lastOwner: true,
  now: NOW,
})

const expiring = (expiresAt: string) =>
  // Text between the tags: what follows each tag's closing bracket.
  renderToStaticMarkup(
    <SwitcherBody data={data(expiresAt)} current="m" orgName="Acme" />,
  )
    .split('<')
    .map((part) => part.slice(part.indexOf('>') + 1))
    .join('')

test('an invitation that lapsed within the day says today, not 0d ago', () => {
  expect(expiring('2026-09-25T09:00:00Z')).toContain('expired today')
  expect(expiring('2026-09-25T09:00:00Z')).not.toContain('0d')
  expect(expiring('2026-09-23T09:00:00Z')).toContain('expired 2d ago')
  expect(expiring('2026-09-30T09:00:00Z')).toContain('expires in 5d')
})

const org = (memberId: string, orgName: string) => ({
  memberId,
  orgName,
  role: 'member' as const,
  locked: false,
})

test('one Org still offers New Org, and Leave needs another Org to go to', () => {
  // Ticket 136: the switcher always opens, because New Org is always there.
  // Leaving the only Org lands on the no-Org page with no way back, so Leave
  // still needs a second Org (Taha, 2026-09-25).
  const alone = { ...data('2026-09-30T09:00:00Z'), lastOwner: false }
  const one = [org('m', 'Acme')]
  const withOrgs = (orgs: ReturnType<typeof org>[]) => ({
    ...alone,
    orgs,
    invites: [],
  })
  const body = (orgs: ReturnType<typeof org>[]) =>
    renderToStaticMarkup(
      <SwitcherBody data={withOrgs(orgs)} current="m" orgName="Acme" />,
    )
  expect(body(one)).toContain('href="/new-org"')
  expect(body(one)).not.toContain('Leave Acme')
  expect(body([...one, org('n', 'Globex')])).toContain('Leave Acme')
})
