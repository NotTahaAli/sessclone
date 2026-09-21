import postgres from 'postgres'

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

// Lazily, and once: a connection per request would exhaust the pool under any
// load, and one opened at module scope would connect during `next build`.
const pool = () => {
  // `postgres(undefined)` silently falls back to localhost and the OS user, so
  // a forgotten variable surfaces as `role "..." does not exist` three layers
  // down. Say what is missing instead.
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return (client ??= postgres(url))
}

/**
 * Runs `query` with no viewer at all, for the public pages.
 *
 * The exception to the rule above, and a narrow one: the marketing pages have
 * no signed-in person, and the only table they read is `tiers`, whose read
 * policy is `using (true)` because the published prices are what the pricing
 * page exists to show. Every other table's policy answers an anonymous caller
 * with nothing, which is what makes this safe to have rather than a way round
 * ADR 0001 — the claim is absent, so `sessclone_user_id()` is null and no
 * policy that tests it can pass.
 *
 * Still a transaction, so the connection this borrows carries no identity
 * from the request before it.
 */
export const asAnyone = <T>(query: (tx: postgres.TransactionSql) => Promise<T>) =>
  pool().begin((tx) => query(tx))

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
export const asViewer = <T>(
  userId: string,
  query: (tx: postgres.TransactionSql) => Promise<T>,
) =>
  pool().begin(async (tx) => {
    // `set_config(…, true)` is `set local` with the value passed as a
    // parameter rather than spliced into the statement.
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId })}, true)`
    return query(tx)
  })
