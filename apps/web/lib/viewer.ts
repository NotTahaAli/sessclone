import { cache } from 'react'
import { isLocked } from './approval'
import { asViewer } from './db'
import { logoPath } from './org-logo'
import type { SubscriptionStatus } from './tier'
import { signedInUser } from './supabase/server'

// Ticket 45: the Org context the shell establishes, read once per request.
//
// Every signed-in page needs the same four facts — who is signed in, which Org
// they are in, what it is called, and what Role they hold — and the Role is
// what decides which navigation entries exist. Reading them in one place is
// what keeps a page from asking again, and what keeps the answer the same
// everywhere on the page.
//
// The Role is read rather than asserted. It comes back through
// `sessclone_own_member_ids()`, so it is the database saying who the viewer is
// under the same policies every other read runs under (ADR 0001) — not a
// claim carried in a cookie. Navigation built from it is a convenience, and
// the policies are still what refuse a surface to somebody who reaches its URL
// directly.

export type Role = 'owner' | 'admin' | 'manager' | 'member'

export type Viewer = {
  userId: string
  email: string
  /** What they call themselves (ticket 91), or null. Read here because the
   * account menu is on every page and was the last place printing the
   * address alone (ticket 100). */
  displayName: string | null
  memberId: string
  orgId: string
  orgName: string
  /**
   * The Org's timezone (ticket 51). Carried here because every surface that
   * cuts Turns into days needs it and this row is already being read once per
   * request — the alternative is each chart asking again for a fact that
   * cannot change mid-render.
   */
  orgTimezone: string
  /**
   * The Org's subscription status, or `null` when it has no subscription row
   * at all — which is every Org until an operator activates it (ticket 48).
   * Carried here for the same reason as the timezone: the shell shows the
   * inactive notice on every page, and reading one enum in a second
   * `asViewer` transaction is a second connection checkout per navigation.
   */
  subscriptionStatus: SubscriptionStatus | null
  role: Role
  /**
   * The Org's logo (ticket 77), already versioned, or null. Read here rather
   * than by the component that draws it: the mark sits beside the Org's name
   * in the shell, so a separate read would be a third `asViewer` transaction
   * on every dashboard load to answer a question this row was already open
   * for.
   */
  orgLogo: string | null
}

type MembershipRow = {
  display_name: string | null
  member_id: string
  org_id: string
  org_name: string
  org_timezone: string
  subscription_status: SubscriptionStatus | null
  role: Role
  logo_updated_at: Date | null
}

/**
 * The signed-in person and the Org they are in, or `null` when there is
 * neither — signed out, or signed in with no membership, which is what a
 * deployment with no database configured looks like from here.
 *
 * The *first* membership when they belong to several, matching
 * `ensureOrgForSigner`: v1 has one Org per person and no Org switcher, so the
 * ticket that adds a second Org is the one that decides which is current.
 *
 * `cache` is what makes "read once per request" true rather than aspirational:
 * the layout and the page it wraps both call this while rendering the same
 * request, and without it that is two `signedInUser()` round trips and two
 * `asViewer` transactions for one navigation. React deduplicates them for the
 * life of the request and no longer.
 */
export const currentViewer = cache(async (): Promise<Viewer | null> => {
  const user = await signedInUser()
  if (!user) return null

  const [membership] = await asViewer(
    user.id,
    (tx) => tx<MembershipRow[]>`
      select member.id as member_id,
             account.display_name,
             member.org_id,
             org.name as org_name,
             org.timezone as org_timezone,
             subscription.status as subscription_status,
             member.role,
             logo.updated_at as logo_updated_at
        from members member
        join orgs org on org.id = member.org_id
        join users account on account.id = member.user_id
        left join subscriptions subscription
               on subscription.org_id = member.org_id
        left join org_logos logo on logo.org_id = member.org_id
       where member.id in (select sessclone_own_member_ids())
       -- Ticket 119: an Org that works before one that is locked, so a
       -- person who joined an Org while holding an unapproved one of their
       -- own (every invitee before ticket 118) lands in the one they use.
       order by subscription.status in ('active', 'past_due') is true desc,
                member.created_at
       limit 1
    `,
  )

  if (!membership) return null

  return {
    userId: user.id,
    email: user.email,
    displayName: membership.display_name,
    memberId: membership.member_id,
    orgId: membership.org_id,
    orgName: membership.org_name,
    orgTimezone: membership.org_timezone,
    subscriptionStatus: membership.subscription_status,
    role: membership.role,
    orgLogo: membership.logo_updated_at
      ? logoPath(membership.org_id, membership.logo_updated_at)
      : null,
  }
})

/**
 * Whether the signed-in viewer's Org is locked (ticket 119). What the
 * dashboard's own API routes ask beside `signedInUser()`, so a locked Org's
 * transcripts and costs are refused there exactly as its pages are by the
 * layout. False for somebody in no Org: the policies already answer them.
 */
export const viewerLocked = async (): Promise<boolean> => {
  const viewer = await currentViewer()
  return viewer !== null && isLocked(viewer.subscriptionStatus)
}

/**
 * Whether this Role reaches Org settings.
 *
 * Settled in `docs/design/product-ia.md`: timezone, retention, appearance
 * defaults, Members, Roles and invitations are all Owner **or Admin**, because
 * `CONTEXT.md` gives an Admin the whole Org's settings with billing as the
 * only exclusion. Tickets 49, 50 and 61 say "Owner" and are narrower than what
 * was settled.
 */
export const reachesOrgSettings = (role: Role) =>
  role === 'owner' || role === 'admin'

/**
 * Whether this Role reaches the Org-wide transcript listing (ticket 84).
 *
 * Owner, Admin and Manager: a Manager is in because their Scope is exactly
 * what the listing is for. Absent for a Member rather than present and empty,
 * since their own transcripts are on Your settings and a second page showing
 * the same rows under a different name only invites the question of which one
 * is the real list.
 *
 * Named Roles rather than `!== 'member'`: this is the gate on the one surface
 * that lists other people's transcripts, which are source code and sometimes
 * a credential, and a Role added later should have to be let in rather than
 * arrive already holding the key.
 */
export const reachesTeamTranscripts = (role: Role) =>
  role === 'owner' || role === 'admin' || role === 'manager'

/**
 * Whether this Role reaches the Tier page.
 *
 * Owner only, and the entry is *absent* for an Admin rather than present and
 * refused — the same rule that split Settings in two, applied one level down.
 */
export const reachesTier = (role: Role) => role === 'owner'
