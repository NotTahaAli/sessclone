import type { TransactionSql } from 'postgres'

// Tickets 90 and 91: the three writes that give something a friendly name.
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
  const rows = label
    ? await tx`
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
    : await tx`
        delete from session_labels
         where member_id = ${memberId} and session_id = ${sessionId}
        returning member_id
      `

  // A delete of a label that was never there wrote nothing and is still what
  // the caller asked for, so clearing reports success on an empty result.
  return label ? rows.length > 0 : true
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
