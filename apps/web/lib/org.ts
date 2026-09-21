import type { TransactionSql } from 'postgres'

// Ticket 51: the Org's own settings, starting with the timezone its days are
// measured in.
//
// One decision, made once per Org, read by every surface that cuts Turns into
// days. It is stored and never applied to a stored row: `turns.occurred_at` is
// an instant, `turn_costs` reads `orgs.timezone` when it buckets, and changing
// the setting therefore re-buckets every chart from the next read. That is the
// whole reason this is a column and not a formatting choice in a component.

/** An IANA zone name, as `pg_timezone_names` spells it. */
export type Timezone = string

/**
 * Every timezone this Postgres will accept, for the control that sets it.
 *
 * Read from the database rather than from a list in this repo, because the
 * database is what the trigger validates against — a list here would drift and
 * offer a name the write then refuses. Roughly 1,200 names, which is a plain
 * `<select>` and not a problem worth a combobox.
 *
 * Deprecated aliases (`US/Eastern`, `posixrules`) are filtered out: they still
 * work, they are not what anybody should be choosing in 2026, and leaving them
 * in makes the list a third longer for no gain. A `%/%` filter also drops
 * bare offsets like `UTC+5`, which have no daylight-saving rule and are the
 * one shape an Org must not store — except `UTC` itself, which is the default
 * and has to stay selectable.
 */
export const listTimezones = async (
  tx: TransactionSql,
): Promise<Timezone[]> => {
  const rows = await tx<{ name: string }[]>`
    select name from pg_timezone_names
     where (name like '%/%' or name = 'UTC')
       and name not like 'posix/%'
       and name not like 'right/%'
       and name not like 'Etc/%'
     order by name
  `
  return rows.map((row) => row.name)
}

/**
 * Sets the Org's timezone.
 *
 * Nothing here decides who may: `orgs_write` is Owner or Admin (ticket 21),
 * and the trigger added with the column refuses a name the timezone database
 * does not know. This runs on the viewer's connection, so both apply.
 *
 * Returns whether a row was written, which is how a caller tells "not allowed"
 * from "already that" without asking a second question — an update refused by
 * policy touches no rows and raises nothing.
 */
export const setOrgTimezone = async (
  tx: TransactionSql,
  orgId: string,
  timezone: Timezone,
): Promise<boolean> => {
  const rows = await tx`
    update orgs set timezone = ${timezone} where id = ${orgId} returning id
  `
  return rows.length > 0
}
