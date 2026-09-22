import type { NavItem } from '../(dashboard)/navigation'

// Ticket 62: the admin area's own navigation.
//
// `docs/design/product-ia.md` is explicit that this does not reuse the Org
// navigation, "because the subjects are different — the deployment's Rates and
// Tiers, and every Org on it, rather than one Org's spend". The components are
// shared; the destinations are not.
//
// Every entry is reachable by exactly one audience, so there is no filtering
// function beside this list the way there is for Settings: the layout's gate
// has already decided, and a person who is not the operator never sees any of
// it.

export const ADMIN_DESTINATIONS: NavItem[] = [
  { href: '/admin/rates', label: 'Rates' },
  { href: '/admin/tiers', label: 'Tiers' },
  { href: '/admin/orgs', label: 'Orgs' },
]
