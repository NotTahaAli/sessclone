import type { TransactionSql } from 'postgres'

import type { Role } from './viewer'

// Ticket 50: changing somebody's Role, and removing somebody who has left.
//
// Both are one column on `members`, and both are refused to anybody but an
// Owner or an Admin by `members_write` and `sessclone_guard_member_columns`
// (ADR 0001). Removal is `removed_at` rather than a delete, which is the whole
// point of the ticket: `turns` points at the Member row, so a delete would
// either fail or take the Org's history with it. The Seat is freed because
// `sessclone_org_seats` counts Members who have not been removed, and the key
// stops working because ingest joins `members` and tests `removed_at is null`.
//
// One thing is refused to everybody, by the trigger ticket 50 adds: the last
// Owner cannot be demoted or removed. An Org with no Owner has no Role left
// that can appoint one.

/** A Role an existing Member can be moved to. */
export const ASSIGNABLE_ROLES: Role[] = ['owner', 'admin', 'manager', 'member']

const outcome = (rows: { length: number }) => rows.length > 0

/**
 * Moves a Member to a Role.
 *
 * Returns whether a row was written: a refusal by `members_write` touches
 * nothing and raises nothing, so the page says "you may not" rather than
 * showing a Role that did not change. The last-Owner rule raises instead, and
 * the caller turns that into its own sentence.
 */
export const setMemberRole = async (
  tx: TransactionSql,
  orgId: string,
  memberId: string,
  role: Role,
): Promise<boolean> => {
  const rows = await tx`
    update members set role = ${role}
     where id = ${memberId} and org_id = ${orgId} and role <> ${role}
     returning id
  `
  return outcome(rows)
}

/**
 * Removes a Member, or re-admits one.
 *
 * Re-admission is here as well as in an invitation because an Admin undoing
 * their own mistake should not have to email the person a link.
 */
export const setMemberRemoved = async (
  tx: TransactionSql,
  orgId: string,
  memberId: string,
  removed: boolean,
): Promise<boolean> => {
  const rows = await tx`
    update members set removed_at = ${removed ? tx`now()` : null}
     where id = ${memberId}
       and org_id = ${orgId}
       and removed_at is ${removed ? tx`null` : tx`not null`}
     returning id
  `
  return outcome(rows)
}
