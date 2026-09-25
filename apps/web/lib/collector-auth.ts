import postgres from 'postgres'

import { hashApiKey } from './api-keys'
import { approvalRequired } from './approval'
import { poolOptions } from './db'

// Ticket 34's verification, in one place because ticket 58 is the second route
// that needs it: a Collector presents an API key, and the key alone decides
// which Member and which Org anything it sends is filed under.
//
// Both routes write as the ingest role rather than through `asViewer` (ADR
// 0001). `turns` and `log_artifacts` deliberately carry no insert policy, so
// there is no policy to satisfy here, and the dashboard's `sessclone_app` has
// no insert grant on either — which is why the connection below reads
// `INGEST_DATABASE_URL` and deliberately does not fall back to `DATABASE_URL`.
// A deployment that confuses the two finds out on its first report rather than
// running with the browser's role able to write Turns.

let client: postgres.Sql | undefined

/**
 * The ingest connection: lazily, and once.
 *
 * A connection per request would exhaust the pool under any load, and one
 * opened at module scope would connect during `next build`.
 */
export const ingestDb = () => {
  // As in `lib/db.ts`: `postgres(undefined)` silently connects to localhost as
  // the OS user, so a forgotten variable would surface as `role "..." does not
  // exist` three layers down. Say what is missing instead.
  const url = process.env.INGEST_DATABASE_URL
  if (!url) throw new Error('INGEST_DATABASE_URL is not set')
  return (client ??= postgres(url, poolOptions))
}

/**
 * `Authorization: Bearer sk_…`, or nothing.
 *
 * The scheme is case-insensitive per RFC 9110; the key is not touched beyond
 * having its whitespace trimmed, because a hash of a key with a stray newline
 * is simply a hash that does not match.
 */
export const presentedKey = (request: Request) => {
  const header = request.headers.get('authorization')
  const [scheme, ...rest] = header?.trim().split(/\s+/) ?? []
  if (scheme?.toLowerCase() !== 'bearer') return undefined
  return rest.join(' ') || undefined
}

export type Caller = { keyId: string; memberId: string; orgId: string }

/**
 * The Member and Org a presented key resolves to, or `undefined`.
 *
 * One indexed lookup, which is what `hashApiKey`'s plain SHA-256 buys: a
 * salted slow hash could not be looked up at all, and verification would
 * become a scan over every key in the deployment on the hottest path in the
 * product.
 *
 * Five conditions, and all five are the database's rather than a route's.
 * `revoked_at is null` is what makes revocation immediate, and `removed_at is
 * null` keeps a removed Member's forgotten key from carrying on reporting into
 * an Org they left. The fourth is ticket 119's lock, the fifth ticket 137's demo.
 */
export const resolveCaller = async (sql: postgres.Sql, presented: string) => {
  const [caller] = await sql<Caller[]>`
    select api_key.id as "keyId",
           member.id as "memberId",
           member.org_id as "orgId"
      from api_keys api_key
      join members member on member.id = api_key.member_id
     where api_key.key_hash = ${hashApiKey(presented)}
       and api_key.revoked_at is null
       and member.removed_at is null
       -- Ticket 137: a demo Org's data is generated, never reported. It has
       -- no keys and its visitor cannot make one, and this refuses one anyway.
       and not exists (select 1 from orgs org
                        where org.id = member.org_id and org.is_demo)
       -- Ticket 119: a locked Org's key is no key at all, answered with the
       -- same 401 so the route cannot be asked whose keys are waiting. The
       -- statuses are UNLOCKED_STATUSES in lib/approval.ts.
       and (${!approvalRequired()}
            or exists (select 1 from subscriptions subscription
                        where subscription.org_id = member.org_id
                          and subscription.status in ('active', 'past_due')))
  `
  return caller
}

/**
 * One answer for every way a key can fail to identify a live Member: absent,
 * malformed, unknown, revoked, or belonging to somebody who has been removed
 * from their Org.
 *
 * They are one answer on purpose. Telling an unauthenticated caller which of
 * those it hit turns a route into an oracle for probing which keys exist, and
 * the Collector's response is the same in every case: stop, and tell the
 * person to check their key.
 *
 * `WWW-Authenticate` because that is what 401 means, and it is what tells a
 * generic HTTP client not to retry the same credential forever.
 */
export const unauthenticated = () =>
  Response.json(
    { error: 'no live API key was presented' },
    { status: 401, headers: { 'www-authenticate': 'Bearer' } },
  )
