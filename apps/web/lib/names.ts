import type { TransactionSql } from 'postgres'
import { z } from 'zod'

// Tickets 90 and 91: the three writes that give something a friendly name,
// and ticket 92's fourth, which is not a name but shares a row with one.
//
// One module, because the three are the same shape — one short string, cleared
// by emptying the box — and because what differs between them is not the
// statement but who may run it, which is a policy and lives in the migration
// (ADR 0001). None of these functions asks who the caller is.
//
// Each returns whether a row was written. A write refused by a policy touches
// nothing and raises nothing, so the caller cannot tell "not yours" from
// "already that" any other way — the same reason `renameDevice` returns a
// boolean.

/** The longest a name may be, matching the check constraints in the schema. */
export const NAME_LIMIT = 60

/** An Org's name as a form posts it: renaming one (ticket 101) and making
 * one (ticket 136). `orgs.name`'s check refuses a blank as well. */
export const OrgNameInput = z.string().trim().min(1).max(NAME_LIMIT)

/** What either form says when the name is not one. */
export const ORG_NAME_RULE = `An Org needs a name of 1 to ${NAME_LIMIT} characters.`

/**
 * Names a Project, or clears the name when given null.
 *
 * `projects_rename` is Owner or Admin, and `projects_guard_columns` refuses
 * every other column — so this statement may be as short as it looks.
 */
export const renameProject = async (
  tx: TransactionSql,
  projectId: string,
  nickname: string | null,
): Promise<boolean> => {
  const rows = await tx`
    update projects set nickname = ${nickname}
     where id = ${projectId}
     returning id
  `
  return rows.length > 0
}

/**
 * Names a Session, or removes the name when given null.
 *
 * A Session is not a row, so there is nothing to update: the label is its own
 * table keyed on `(member_id, session_id)`, and naming one is an upsert. The
 * Org comes from the caller's membership rather than from the form, and the
 * composite foreign key refuses it if it disagrees with the Member's.
 *
 * Clearing deletes rather than storing an empty string: every surface falls
 * back to the key on absence, and a row holding `''` would render as a blank
 * where a key should be. The check constraint refuses it too.
 */
export const labelSession = async (
  tx: TransactionSql,
  orgId: string,
  memberId: string,
  sessionId: string,
  label: string | null,
): Promise<boolean> => {
  if (label) {
    const rows = await tx`
      insert into session_labels ${tx({
        org_id: orgId,
        member_id: memberId,
        session_id: sessionId,
        label,
      })}
      on conflict (member_id, session_id)
        do update set label = excluded.label, updated_at = now()
      returning member_id
    `
    return rows.length > 0
  }

  await clearRow(tx, memberId, sessionId, 'label')

  // A delete of a label that was never there wrote nothing and is still what
  // the caller asked for, so clearing reports success on an empty result.
  return true
}

/** What a Session can be, beyond listed (ticket 92). */
export type SessionState = 'archived' | 'hidden'

/**
 * Archives or hides a Session, or puts it back in the list when given null.
 *
 * The same row and the same policy as the label above — `session_labels_write`
 * is the Session's own Member, or an Owner or Admin of its Org — so this
 * function, like the others here, asks nobody who the caller is.
 *
 * Neither state is a delete and neither is a number: no Turn moves and
 * `turn_costs` is not consulted, so the month's total is the same before and
 * after. What changes is which rows `sessionList` returns.
 */
export const setSessionState = async (
  tx: TransactionSql,
  orgId: string,
  memberId: string,
  sessionId: string,
  state: SessionState | null,
): Promise<boolean> => {
  if (state) {
    const rows = await tx`
      insert into session_labels ${tx({
        org_id: orgId,
        member_id: memberId,
        session_id: sessionId,
        state,
      })}
      on conflict (member_id, session_id)
        do update set state = excluded.state, updated_at = now()
      returning member_id
    `
    return rows.length > 0
  }

  await clearRow(tx, memberId, sessionId, 'state')
  return true
}

/**
 * Clears one of the row's two fields, and takes the row with it when that
 * leaves nothing.
 *
 * Two statements rather than one because the row means two different things
 * in the two cases: a Session with a name and no state is a row worth
 * keeping, and a Session with neither is a row that says nothing. The delete
 * runs first, so the update only ever touches rows that survive it —
 * `session_labels_not_empty` refuses the other order.
 */
const clearRow = async (
  tx: TransactionSql,
  memberId: string,
  sessionId: string,
  field: 'label' | 'state',
) => {
  if (field === 'label') {
    await tx`
      delete from session_labels
       where member_id = ${memberId} and session_id = ${sessionId}
         and state is null
    `
    await tx`
      update session_labels set label = null, updated_at = now()
       where member_id = ${memberId} and session_id = ${sessionId}
    `
    return
  }

  await tx`
    delete from session_labels
     where member_id = ${memberId} and session_id = ${sessionId}
       and label is null
  `
  await tx`
    update session_labels set state = null, updated_at = now()
     where member_id = ${memberId} and session_id = ${sessionId}
  `
}

/**
 * Sets the signed-in person's own display name, or clears it.
 *
 * Whose row this is is `users_write_self` (ticket 91): the statement names no
 * user, `sessclone_user_id()` does, and a row that is not the caller's matches
 * nothing. Nobody names anybody else.
 */
export const setDisplayName = async (
  tx: TransactionSql,
  userId: string,
  name: string | null,
): Promise<boolean> => {
  const rows = await tx`
    update users set display_name = ${name}
     where id = ${userId}
     returning id
  `
  return rows.length > 0
}

/** The name the signed-in person has set, or null. */
export const ownDisplayName = async (
  tx: TransactionSql,
  userId: string,
): Promise<string | null> => {
  const [row] = await tx<{ display_name: string | null }[]>`
    select display_name from users where id = ${userId}
  `
  return row?.display_name ?? null
}

/**
 * The name this Project has been given, or null.
 *
 * Read on its own rather than carried on the breakdown row: every other
 * surface wants the label — the name or, failing that, the key — and only the
 * page holding the box needs to know which of the two it is showing. One
 * statement, on one page, by primary key.
 */
export const projectNickname = async (
  tx: TransactionSql,
  projectId: string,
): Promise<string | null> => {
  const [row] = await tx<{ nickname: string | null }[]>`
    select nickname from projects where id = ${projectId}
  `
  return row?.nickname ?? null
}

/**
 * Renames an Org (ticket 101).
 *
 * `orgs_write` is Owner or Admin, so this asks nobody who the caller is. There
 * is no clearing: an Org always has a name, and `orgs.name`'s check refuses a
 * blank, so the action turns an empty box away before it gets here.
 */
export const renameOrg = async (
  tx: TransactionSql,
  orgId: string,
  name: string,
): Promise<boolean> => {
  const rows = await tx`
    update orgs set name = ${name} where id = ${orgId} returning id
  `
  return rows.length > 0
}

/**
 * Sets what platform administrators call an Org, or clears it given null
 * (ticket 102).
 *
 * `org_operator_names_admin` is the platform administrator only, so an Owner
 * running this writes nothing and reads nothing back. Clearing deletes the
 * row, as a Session's label does, so absence is the one way to say "none".
 */
export const setOrgOperatorName = async (
  tx: TransactionSql,
  orgId: string,
  name: string | null,
): Promise<boolean> => {
  if (!name) {
    // A name that was never there is still cleared, so an empty delete is
    // success; a caller the policy refuses never reaches this (the action
    // checks `currentOperator` first) and reads as success too.
    await tx`delete from org_operator_names where org_id = ${orgId}`
    return true
  }

  const rows = await tx`
    insert into org_operator_names (org_id, name) values (${orgId}, ${name})
    on conflict (org_id)
      do update set name = excluded.name, updated_at = now()
    returning org_id
  `
  return rows.length > 0
}
