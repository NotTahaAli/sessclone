import postgres from 'postgres'

import { DemoRefusal, isDemoUser, READ_ONLY_TRANSACTION } from './demo'

// ADR 0007's connection function, and the only way anything in this app
// obtains a connection.
//
// The decision it enforces: every read and write reaches Postgres *as the
// signed-in person*, inside a transaction with their claim set, so the
// row-level security policies in `supabase/migrations/` apply exactly as they
// would to a Supabase request. The failure it exists to prevent is a query
// that forgets to set the claim and runs with `sessclone_user_id()` null — the
// page then quietly shows nothing, or, on a connection that owns the tables,
// everything.
//
// So there is deliberately no exported path that hands back a bare connection.
// Forgetting the claim is not a thing a page can express.

let client: postgres.Sql | undefined

/**
 * The options every connection in this app is opened with.
 *
 * Both exist for one deployment shape — this app on a serverless host, reading
 * Postgres through a transaction-mode pooler (Supabase's Supavisor on 6543,
 * PgBouncer, or a managed equivalent). Neither costs anything on a long-lived
 * server against a direct connection, which is why they are unconditional
 * rather than a variable a self-hoster has to know to set.
 *
 * `prepare: false` because a transaction-mode pooler does not support named
 * prepared statements: the pooler hands the next statement to a different
 * backend connection, and the app fails with `prepared statement "…" already
 * exists` — Supabase documents disabling them as the fix. Every query here is
 * already inside a transaction, which is what makes transaction pooling the
 * right mode in the first place; only the prepared-statement cache is not.
 *
 * `idle_timeout` because a serverless instance is frozen between requests. Its
 * TCP keepalive timers freeze with it while the pooler, or a NAT in between,
 * drops the connection it is holding — and the next request resumes and writes
 * into a socket nobody is reading, which hangs until the function times out.
 * Closing an idle connection after twenty seconds means the instance opens a
 * fresh one instead of waking with a dead one.
 */
export const poolOptions: postgres.Options<Record<string, never>> = {
  prepare: false,
  idle_timeout: 20,
}

// Lazily, and once: a connection per request would exhaust the pool under any
// load, and one opened at module scope would connect during `next build`.
const pool = () => {
  // `postgres(undefined)` silently falls back to localhost and the OS user, so
  // a forgotten variable surfaces as `role "..." does not exist` three layers
  // down. Say what is missing instead.
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return (client ??= postgres(url, poolOptions))
}

/**
 * The two public tables, read with no viewer at all: the published Tiers, and
 * an Org's logo.
 *
 * The one exception to the rule above, and deliberately not a general one.
 * It is safe because of what it can reach, not because of where it is called
 * from: `tiers_read` and `org_logos_read` are the only `using (true)` read
 * policies in the schema, every other read policy tests
 * `sessclone_user_id()`, which is null here, and so does every write policy on
 * a table this role may write to. So a caller who passed a query for anything
 * else would read nothing — which is why this stayed one function when ticket
 * 77 added the second table rather than becoming a pair that differ only in
 * their name.
 *
 * Why a logo is public at all is argued in `20260922130000_org_logo.sql`: it
 * is fetched by mail clients and by visitors who have not signed in, and it
 * carries nothing but the picture.
 *
 * The same file's `sessclone_invitation_org` is reached this way too, and is
 * the reason the sentence above says "what it can reach" rather than "which
 * tables": a `security definer` function is authorised by what it is given,
 * and that one is given a token's hash.
 */
export const readAnonymously = <T>(
  query: (tx: postgres.TransactionSql) => Promise<T>,
) => pool().begin((tx) => query(tx))

/**
 * Runs `query` in a transaction with `userId` as the viewer.
 *
 * The id comes from the verified Supabase session and never from a request
 * header, which is attacker-controllable — the same reasoning that keeps
 * `NEXT_PUBLIC_APP_URL` out of `Host`.
 *
 * `set local` makes the claim transaction-local, so a connection returned to
 * the pool carries no identity to the next viewer's query.
 */
export const asViewer = async <T>(
  userId: string,
  query: (tx: postgres.TransactionSql) => Promise<T>,
) => {
  const demo = isDemoUser(userId)
  try {
    return await pool().begin(async (tx) => {
      // Ticket 137: the demo visitor's every transaction is read-only, so
      // Postgres refuses any write (25006) whichever action forgot to check.
      // It must be the transaction's first statement.
      if (demo) await tx`set transaction read only`
      // `set_config(…, true)` is `set local` with the value passed as a
      // parameter rather than spliced into the statement.
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`
      return query(tx)
    })
  } catch (error) {
    if (
      demo &&
      error instanceof Error &&
      'code' in error &&
      error.code === READ_ONLY_TRANSACTION
    ) {
      throw new DemoRefusal()
    }
    throw error
  }
}

/**
 * The database's own clock, read as its own statement inside a viewer's
 * transaction — for a "page was read at" timestamp that a later mark (e.g.
 * `markFailuresViewed`) compares against a column the database itself
 * stamped (`received_at`). The app server's clock can skew from the
 * database's; `now()` is transaction start, which is fine here since it is
 * read before this transaction's other statements.
 */
export const pageSeenAt = async (
  tx: postgres.TransactionSql,
): Promise<Date> => {
  const [row] = await tx<{ now: Date }[]>`select now()`
  return row!.now
}
