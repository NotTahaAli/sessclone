import type { TransactionSql } from 'postgres'

import type { Role } from './viewer'

// Ticket 46: which Members a Manager may see.
//
// The Scope itself is enforced nowhere in this file. `member_scopes` carries
// its own policies and `sessclone_visible_member_ids()` is what every read of
// a Turn, a Device, a Project or a Log Artifact resolves through, so a Manager
// with an empty Scope sees nothing because the policies say so and not because
// a page filtered a list (ADR 0001, proven by ticket 44's suite). What is here
// is the assignment, and the Manager's own view of what was assigned.
//
// The absence of a row is the default, and the default is empty. That is the
// ticket's fourth criterion and it is a property of the schema rather than of
// a query: there is no "all" value a bug can leave in place.

export type OrgMember = {
  memberId: string
  email: string
  role: Role
  /** A removed Member keeps their history, so they stay listed and marked. */
  removed: boolean
}

type MemberRow = {
  member_id: string
  email: string
  role: Role
  removed: boolean
}

/**
 * Every Member of the Org, Managers included.
 *
 * Read under `members_read`, which gives an Owner or an Admin the whole Org —
 * so this is the full list for the people who assign a Scope, and a partial
 * one for anybody else. The page that uses it is theirs; the policy is what
 * makes that true rather than the route.
 *
 * Bounded, because the page renders a control per (Manager, Member) pair and
 * an unbounded read is a rule this repo states outright. The ceiling is a
 * page's worth of Members rather than a real pager: the Team Tier stops at ten
 * seats and an Enterprise Org large enough to hit this needs search on this
 * screen rather than a Next button, which is ticket 49's to build alongside
 * invitations. `more` says the list was cut so the page can say so too.
 */
export const listOrgMembers = async (
  tx: TransactionSql,
  orgId: string,
  limit = 200,
): Promise<{ members: OrgMember[]; more: boolean }> => {
  const rows = await tx<MemberRow[]>`
    select member.id as member_id,
           account.email,
           member.role,
           member.removed_at is not null as removed
      from members member
      join users account on account.id = member.user_id
     where member.org_id = ${orgId}
     order by member.removed_at nulls first, account.email
     limit ${limit + 1}
  `
  return {
    members: rows.slice(0, limit).map((row) => ({
      memberId: row.member_id,
      email: row.email,
      role: row.role,
      removed: row.removed,
    })),
    more: rows.length > limit,
  }
}

/**
 * Every Scope assignment in the Org, as `manager -> [member]`.
 *
 * One query rather than one per Manager: a page with five Managers and a query
 * each is the query-in-a-loop this repo calls a bug.
 */
export const listScopes = async (
  tx: TransactionSql,
  orgId: string,
): Promise<Map<string, Set<string>>> => {
  const rows = await tx<{ manager_member_id: string; member_id: string }[]>`
    select manager_member_id, member_id
      from member_scopes where org_id = ${orgId}
  `

  const byManager = new Map<string, Set<string>>()
  for (const row of rows) {
    let scope = byManager.get(row.manager_member_id)
    if (!scope) byManager.set(row.manager_member_id, (scope = new Set()))
    scope.add(row.member_id)
  }
  return byManager
}

/**
 * Adds or removes one Member from one Manager's Scope.
 *
 * Nothing here decides who may: `member_scopes_assign` and
 * `member_scopes_revoke` are both "an Org this caller administers", which is
 * Owner or Admin. The composite foreign keys are the second lock and the more
 * interesting one — `(org_id, manager_member_id)` and `(org_id, member_id)`
 * both reference `members (org_id, id)`, so an Org id the caller does
 * administer cannot be paired with a Manager or a Member from an Org they do
 * not. A row that crossed an Org boundary would be invisible to everyone and
 * would grant a Manager somebody else's Org.
 *
 * `on conflict do nothing`, so assigning twice is not an error: two presses of
 * a stale page land on the same Scope rather than failing the second.
 *
 * The two halves refuse differently, and a caller has to know it: an insert a
 * policy refuses raises a `with check` violation, while a delete a policy
 * refuses removes nothing and says nothing. So "no error" never means "it
 * worked" here, and this returns nothing rather than a boolean that would only
 * be honest in one direction — the page re-reads the Scope, which is the one
 * answer that is true either way.
 */
export const setScope = async (
  tx: TransactionSql,
  orgId: string,
  managerMemberId: string,
  memberId: string,
  included: boolean,
): Promise<void> => {
  if (included) {
    await tx`
      insert into member_scopes (org_id, manager_member_id, member_id)
      values (${orgId}, ${managerMemberId}, ${memberId})
      on conflict do nothing
    `
    return
  }

  await tx`
    delete from member_scopes
     where org_id = ${orgId}
       and manager_member_id = ${managerMemberId}
       and member_id = ${memberId}
  `
}

export type OwnScope = {
  orgId: string
  orgName: string
  managerMemberId: string
  /** The Members this Manager may see. Empty is the default, not a failure. */
  members: { memberId: string; email: string }[]
}

/**
 * The Manager's own view of their Scope, for every Org where they are one.
 *
 * The ticket's second criterion, and it is about trust rather than about
 * convenience: a Manager who cannot see their Scope cannot tell a Member they
 * were not given from a Member who has reported nothing, and will read the
 * first as a bug in the product.
 *
 * `member_scopes_read` has a branch for exactly this — the rows whose
 * `manager_member_id` is one of the caller's own memberships — so a Manager
 * reads their own assignment without being able to read anybody else's.
 */
export const ownScopes = async (tx: TransactionSql): Promise<OwnScope[]> => {
  const rows = await tx<
    {
      org_id: string
      org_name: string
      manager_member_id: string
      member_id: string | null
      email: string | null
    }[]
  >`
    select org.id as org_id,
           org.name as org_name,
           manager.id as manager_member_id,
           scope.member_id,
           account.email
      from members manager
      join orgs org on org.id = manager.org_id
      left join member_scopes scope
        on scope.manager_member_id = manager.id
      left join members scoped on scoped.id = scope.member_id
      left join users account on account.id = scoped.user_id
     where manager.id in (select sessclone_own_member_ids())
       and manager.role = 'manager'
     order by org.name, account.email
  `

  const byManager = new Map<string, OwnScope>()
  for (const row of rows) {
    let scope = byManager.get(row.manager_member_id)
    if (!scope) {
      byManager.set(
        row.manager_member_id,
        (scope = {
          orgId: row.org_id,
          orgName: row.org_name,
          managerMemberId: row.manager_member_id,
          members: [],
        }),
      )
    }
    // `left join`, so a Manager with an empty Scope is one row with no member.
    if (row.member_id && row.email) {
      scope.members.push({ memberId: row.member_id, email: row.email })
    }
  }
  return [...byManager.values()]
}
