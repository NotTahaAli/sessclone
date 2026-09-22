import {
  reachesOrgSettings,
  reachesTeamTranscripts,
  type Role,
} from '../../lib/viewer'

// Ticket 45: the four destinations, and which of them a Role reaches.
//
// `docs/design/product-ia.md` fixes both. All four are reachable by every
// Role — what a Role sees *inside* Costs differs, and that is decided by the
// policies rather than by this list (ADR 0001, proven by ticket 44). Keys and
// Devices are top-level rather than buried in settings because both are part
// of installing the Collector, which is the one thing everybody has to do
// before the product does anything at all.
//
// Settings is the one entry that leads somewhere with a choice behind it: two
// destinations, Org settings and Your settings, which `/settings` lists
// according to the Role. That keeps the navigation at four items on both
// widths, which is what the wireframes draw.

export type NavItem = { href: string; label: string }

export const DESTINATIONS: NavItem[] = [
  { href: '/costs', label: 'Costs' },
  { href: '/keys', label: 'Keys' },
  { href: '/devices', label: 'Devices' },
  { href: '/settings', label: 'Settings' },
]

/**
 * The settings destinations this Role reaches, in the order they are listed.
 *
 * Your settings is everyone's. Org settings is absent for a Manager or a
 * Member rather than present and refused: a page that is mostly refused reads
 * as broken, and on the one surface that is entirely about the signed-in
 * person it invites the conclusion that something is wrong with their account.
 */
export const settingsFor = (role: Role): (NavItem & { about: string })[] => [
  {
    href: '/settings/you',
    label: 'Your settings',
    about: 'Your appearance, your archival, your Devices and your Scope.',
  },
  ...(reachesTeamTranscripts(role)
    ? [
        {
          href: '/settings/transcripts',
          label: 'Team transcripts',
          about:
            'The transcripts stored by the people you can see, and their downloads.',
        },
      ]
    : []),
  ...(reachesOrgSettings(role)
    ? [
        {
          href: '/settings/org',
          label: 'Org settings',
          about:
            'Timezone, retention, appearance defaults, Members and invitations.',
        },
      ]
    : []),
]
