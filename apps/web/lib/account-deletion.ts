import type postgres from 'postgres'

// Ticket 141: deleting your own account (Taha, 2026-09-25).
//
// Anonymized, not removed: Turns are the Org's spend record (ADR 0006), so
// the `users` row stays, scrubbed, and prints as "Deleted person · <tag>"
// wherever a name is shown. The rules live in
// `20260925190000_history_and_deletion.sql`; this module is who calls them.
//
// Three steps. A person asks (Settings > You), which freezes them for
// `GRACE_DAYS`: signed out, their keys refused by ingest, a Keep-my-account
// page on sign-in. The daily cron then scrubs them in SQL and removes their
// sign-in through Supabase's Admin API — the one place the service role key
// is used outside ingest, server side, behind the cron secret.

/** How long a request waits before it is carried out. */
export const GRACE_DAYS = 14

/** How recent a sign-in must be to ask. Asking is the one irreversible
 * button, so a laptop left open is not enough. */
export const FRESH_SIGN_IN_SECONDS = 10 * 60

/** People scrubbed per cron call; the rest wait for the next one. */
export const FINALIZE_LIMIT = 50

/**
 * When the person last proved who they are, from the access token's claims.
 *
 * Supabase stamps each authentication method in `amr` with its own time; a
 * refreshed token keeps the original ones, so `iat` would call a week-old
 * sign-in fresh. The newest `amr` entry is the last real sign-in.
 */
export const lastSignInAt = (claims: { amr?: unknown }): Date | null => {
  if (!Array.isArray(claims.amr)) return null
  const amr: unknown[] = claims.amr
  const stamps = amr
    .map((entry) =>
      typeof entry === 'object' && entry !== null && 'timestamp' in entry
        ? Number(entry.timestamp)
        : Number.NaN,
    )
    .filter((stamp) => Number.isFinite(stamp))
  return stamps.length === 0 ? null : new Date(Math.max(...stamps) * 1000)
}

export const signInIsFresh = (claims: { amr?: unknown }, now = new Date()) => {
  const at = lastSignInAt(claims)
  return (
    at !== null && now.getTime() - at.getTime() <= FRESH_SIGN_IN_SECONDS * 1000
  )
}

/** Orgs where the caller is the only Owner and not the only Member. */
export const ownDeletionBlockers = (tx: postgres.TransactionSql) =>
  tx<{ org_id: string; org_name: string }[]>`
    select org_id, org_name from sessclone_own_deletion_blockers()
  `

/** When the caller's deletion was asked for, or null. */
export const ownDeletionRequest = async (
  tx: postgres.TransactionSql,
  userId: string,
): Promise<Date | null> => {
  const [row] = await tx<{ deletion_requested_at: Date | null }[]>`
    select deletion_requested_at from users where id = ${userId}
  `
  return row?.deletion_requested_at ?? null
}

/** The day a request made at `requested` is carried out. */
export const deletionDue = (requested: Date) =>
  new Date(requested.getTime() + GRACE_DAYS * 86_400_000)

export const requestOwnDeletion = async (tx: postgres.TransactionSql) => {
  const [row] = await tx<{ requested: Date }[]>`
    select sessclone_request_account_deletion() as requested
  `
  return row!.requested
}

export const cancelOwnDeletion = async (tx: postgres.TransactionSql) => {
  await tx`select sessclone_cancel_account_deletion()`
}

export type Finalized = {
  /** Scrubbed this call. */
  scrubbed: number
  /** Sign-ins removed this call. */
  signInsRemoved: number
  /** Scrubbed people whose sign-in could not be removed; retried next call. */
  failed: string[]
}

/**
 * Carries out every request past its grace, as the owning role.
 *
 * Scrub first, one person per transaction, so one failure never holds back
 * the rest. Then the sign-in: the Admin API is outside the database, so it
 * runs after the scrub commits, and a person scrubbed but still holding a
 * sign-in is retried next call (and listed on the Admin panel meanwhile).
 * `removeSignIn` must treat "already gone" as success.
 */
export const finalizeDueDeletions = async (
  sql: postgres.Sql,
  removeSignIn: (userId: string) => Promise<void>,
  limit = FINALIZE_LIMIT,
): Promise<Finalized> => {
  const due = await sql<{ id: string }[]>`
    select id from users
     where deleted_at is null
       and deletion_requested_at <= now() - ${`${GRACE_DAYS} days`}::interval
     order by deletion_requested_at
     limit ${limit}
  `
  let scrubbed = 0
  for (const { id } of due) {
    // oxlint-disable-next-line no-await-in-loop -- one transaction per person.
    const [row] = await sql<{ done: boolean }[]>`
      select sessclone_finalize_account_deletion(${id}) as done
    `
    if (row?.done) scrubbed += 1
  }

  const pending = await sql<{ id: string }[]>`
    select id from users
     where deleted_at is not null and deletion_requested_at is not null
     order by deleted_at
     limit ${limit}
  `
  let signInsRemoved = 0
  const failed: string[] = []
  for (const { id } of pending) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- the Admin API, one by one.
      await removeSignIn(id)
      // oxlint-disable-next-line no-await-in-loop
      await sql`select sessclone_forget_deletion_request(${id})`
      signInsRemoved += 1
    } catch {
      failed.push(id)
    }
  }

  return { scrubbed, signInsRemoved, failed }
}

/** People scrubbed whose sign-in removal has not succeeded yet. For the
 * Admin panel: a deployment without the service role key piles them up. */
export const stuckDeletions = (tx: postgres.TransactionSql | postgres.Sql) =>
  tx<{ id: string; deleted_at: Date }[]>`
    select id, deleted_at from users
     where deleted_at is not null and deletion_requested_at is not null
     order by deleted_at
  `
