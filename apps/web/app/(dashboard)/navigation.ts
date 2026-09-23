import { reachesOrgSettings, type Role } from '../../lib/viewer'

// Ticket 85: three groups rather than one flat list.
//
// Ticket 45 built four destinations and `navigation.ts` called all four, which
// is what fits a phone's bottom bar. Tickets 86, 87 and 88 make six, and six
// flat items read as a list of everything rather than as a product — so the
// destinations are grouped by what a person is there to do, which is the
// grouping Taha settled on 2026-09-22:
//
//  - **Usage** — Costs, Sessions, Transcripts: what the product is for, and
//    where somebody who opens the dashboard on a Tuesday is going.
//  - **Collector** — Keys and Devices: what you set up once and revisit when a
//    machine changes. The existing comment on those two already said they are
//    top-level "because both are part of installing the Collector"; this is
//    that sentence turned into the label.
//  - **Manage** — Settings, and the Admin panel for the one viewer entitled to
//    it. Labelled "Manage" rather than "Settings" so the group and the item
//    inside it are not the same word.
//
// The admin entry is the only conditional one, and it is conditional on
// `is_platform_admin` rather than on a Role — no Role grants it, which is why
// `platformAdmin` is a separate argument from `role` here and why the flag is
// read from the database (`lib/platform-admin.ts`) rather than from a claim.

export type NavItem = {
  href: string
  label: string
  /** A count beside the label, such as Orgs waiting for approval (ticket
   * 120). Absent or zero draws nothing. */
  badge?: number
}
export type NavGroup = { label: string; items: NavItem[] }

/** What the product is for: the three a person opens the dashboard to read. */
export const PRIMARY: NavItem[] = [
  { href: '/costs', label: 'Costs' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/transcripts', label: 'Transcripts' },
]

/** Installed once, revisited when a machine changes. */
export const COLLECTOR: NavItem[] = [
  { href: '/keys', label: 'Keys' },
  { href: '/devices', label: 'Devices' },
]

export const SETTINGS: NavItem = { href: '/settings', label: 'Settings' }

/**
 * The operator's area (ticket 62), which is not an Org surface at all — it is
 * listed here only because Taha asked for a way in that is not a typed path.
 */
export const ADMIN_PANEL: NavItem = { href: '/admin', label: 'Admin panel' }

/** The Admin panel entry with the count of Orgs waiting for approval beside
 * it (ticket 120). */
export const adminPanelEntry = (pending: number): NavItem[] => [
  { ...ADMIN_PANEL, badge: pending },
]

/**
 * The phone's fifth entry. Six items do not fit a bottom bar, so it carries
 * the three above plus this, and the setup surfaces are one tap further
 * instead of absent.
 *
 * A destination rather than a sheet: a page is what `/settings` already is,
 * it needs no client JavaScript, the browser's back button undoes it, and the
 * current-destination mark is the same `usePathname` comparison every other
 * entry uses.
 */
export const MORE: NavItem = { href: '/more', label: 'More' }

/**
 * The three groups, with the admin entry present only for the flag.
 *
 * `platformAdmin` defaults to false so a caller that has not read the flag
 * yet — the prerendered shell, before the viewer has streamed in — renders
 * the navigation without it rather than rendering nothing.
 */
export const navGroups = (platformAdmin = false): NavGroup[] => [
  { label: 'Usage', items: PRIMARY },
  { label: 'Collector', items: COLLECTOR },
  {
    label: 'Manage',
    items: platformAdmin ? [SETTINGS, ADMIN_PANEL] : [SETTINGS],
  },
]

/** What the bottom bar carries: the three, and the way to the rest. */
export const BOTTOM_BAR: NavItem[] = [...PRIMARY, MORE]

/**
 * What `/more` lists, which is every destination the bottom bar does not.
 *
 * One function rather than two lists to keep in agreement: a destination added
 * to a group below the first appears on the More page by being in that group.
 */
export const moreItems = (platformAdmin = false): NavItem[] =>
  navGroups(platformAdmin)
    .slice(1)
    .flatMap((group) => group.items)

/**
 * The settings destinations this Role reaches, in the order they are listed.
 *
 * Your settings is everyone's. Org settings is absent for a Manager or a
 * Member rather than present and refused: a page that is mostly refused reads
 * as broken, and on the one surface that is entirely about the signed-in
 * person it invites the conclusion that something is wrong with their account.
 *
 * Team transcripts left this list in ticket 87. It was a thing a person comes
 * looking for rather than a thing they come to change, and it is `/transcripts`
 * now — listed here would be a second door onto one room.
 */
export const settingsFor = (role: Role): (NavItem & { about: string })[] => [
  {
    href: '/settings/you',
    label: 'Your settings',
    about: 'Your appearance, your archival, your Devices and your Scope.',
  },
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
