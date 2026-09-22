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
 * Every timezone an Org may be set to, for the control that sets it.
 *
 * The same four conditions the trigger on `orgs.timezone` enforces, written
 * once here so the list cannot offer a name the write then refuses. A region
 * name (`Europe/London`) carries a daylight-saving rule; `EST`, `Etc/GMT+5`
 * and the rest are fixed offsets wearing a name, and `posix/` and `right/` are
 * the same zones again under different leap-second rules. `UTC` is the one
 * offset an Org may choose, and is the default.
 *
 * Read from the database rather than from a list in this repo, because the
 * database is what the trigger validates against. Roughly 1,200 names, which
 * is a plain `<select>` and not a problem worth a combobox.
 */
let cached: Timezone[] | undefined

export const listTimezones = async (
  tx: TransactionSql,
): Promise<Timezone[]> => {
  // One array, for the life of the process. `pg_timezone_names` is a
  // set-returning function over the whole timezone database rather than a
  // catalog read, and the answer cannot change while Postgres is running —
  // so reading it once per render of a settings page is 1,200 rows for a
  // constant. Bounded by construction, which is what `AGENTS.md` asks of a
  // module-level cache: one list, replaced rather than grown.
  if (cached) return cached

  const rows = await tx<{ name: string }[]>`
    select name from pg_timezone_names
     where (name like '%/%' or name = 'UTC')
       and name not like 'posix/%'
       and name not like 'right/%'
       and name not like 'Etc/%'
  `
  // Sorted here rather than by `order by name`, which sorts by the database's
  // collation: under `en_US.utf8` punctuation is weighed differently to
  // `C`, so the same deployment code produced a differently ordered `<select>`
  // depending on how the cluster was initialised. One order, decided by the
  // app.
  return (cached = rows.map((row) => row.name).toSorted())
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

/**
 * The Org's Retention window in days, and the ceiling its Tier allows.
 *
 * Both in one read because the control needs both: a number to show and the
 * bound to refuse past. `retention_max_days` is null for a Tier with no
 * ceiling, and an Org with no active subscription has no ceiling either — no
 * Tier is no entitlement everywhere else (ADR 0004), but a ceiling is a
 * restriction rather than an entitlement, and inventing one would delete the
 * transcripts of every Org an operator has not activated yet.
 */
export const orgRetention = async (
  tx: TransactionSql,
  orgId: string,
): Promise<{ days: number; ceiling: number | null } | null> => {
  const [row] = await tx<{ days: number; ceiling: number | null }[]>`
    select org.retention_days as days, tier.retention_max_days as ceiling
      from orgs org
      left join subscriptions subscription
             on subscription.org_id = org.id
            and subscription.status = 'active'
      left join tiers tier on tier.id = subscription.tier_id
     where org.id = ${orgId}
  `
  return row ?? null
}

/**
 * Sets how long the Org keeps a stored transcript.
 *
 * Who may: `orgs_write`, which is Owner or Admin — the same policy the
 * timezone leans on, and the reason this function names no Role. What may:
 * the trigger beside the column, which raises when the window is past the
 * Tier's ceiling, so a Tier that shrinks cannot be outrun by a form that
 * was rendered before it did.
 *
 * Returns whether a row was written, so a caller can tell a refusal by policy
 * from a value that was already set — an update refused by policy touches no
 * rows and raises nothing.
 */
export const setOrgRetention = async (
  tx: TransactionSql,
  orgId: string,
  days: number,
): Promise<boolean> => {
  const rows = await tx`
    update orgs set retention_days = ${days} where id = ${orgId} returning id
  `
  return rows.length > 0
}
