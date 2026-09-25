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
