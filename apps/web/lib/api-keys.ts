import { createHash, randomBytes } from 'node:crypto'

import type postgres from 'postgres'

import { approvalRequired } from './approval'

// Ticket 28's key material and the four statements that touch `api_keys`.
//
// The statements live here rather than in `app/keys/actions.ts` for one
// reason: a Server Action cannot be run from a test — it wants `cookies()` and
// a request — so SQL written inside one is SQL nothing proves. Each function
// below takes the transaction instead. The page passes the one `asViewer`
// opens, `test/api-keys.test.ts` passes the one `asUser` opens, and both are
// the same connection with the same claim set, so the policy the test exercises
// is the policy the page runs under.
//
// Note what is *not* here: no `where member_id = …`. `api_keys_own` is what
// decides whose keys these are, and a hand-written filter beside it is a second
// answer to the same question that can drift from the first (ADR 0001).

/** `sk_` and 32 random bytes, base64url. 43 characters of secret. */
const PREFIX = 'sk_'
const SECRET_BYTES = 32

/** What `key_prefix` stores, and what the dashboard shows. */
const PREFIX_LENGTH = 12

/**
 * The hash a presented key is checked against.
 *
 * **SHA-256, deliberately, and not bcrypt or argon2.** Those exist to make
 * guessing a *password* expensive, because a password is low-entropy and
 * chosen by a person. This key is 256 bits from `randomBytes`: there is
 * nothing to guess, no dictionary to run, and no rainbow table to build, so a
 * slow hash buys no security here.
 *
 * It costs plenty, though. Ticket 34 verifies a key on every ingest request,
 * and a salted slow hash cannot be looked up — the salt differs per row, so
 * verification becomes "fetch every key and hash the candidate against each",
 * a per-row scan that grows with the deployment. A plain hash of the whole key
 * is deterministic, so ticket 34 is one indexed lookup:
 *
 *   select … from api_keys where key_hash = ${hashApiKey(presented)}
 *                              and revoked_at is null
 *
 * against the `unique` index the migration already put on `key_hash`.
 */
export const hashApiKey = (key: string) =>
  createHash('sha256').update(key).digest('hex')

/**
 * A new secret, the handful of characters worth showing, and what to store.
 *
 * The prefix is the front of the key rather than a separate random string, so
 * a key found in a config file can be matched to the row that issued it
 * without the row holding anything that helps present it.
 */
export const generateApiKey = () => {
  const key = PREFIX + randomBytes(SECRET_BYTES).toString('base64url')
  return { key, prefix: key.slice(0, PREFIX_LENGTH), hash: hashApiKey(key) }
}

export type ApiKeyRow = {
  id: string
  label: string
  key_prefix: string
  org_name: string
  created_at: Date
  last_used_at: Date | null
  revoked_at: Date | null
}

export type Membership = { member_id: string; org_name: string }

/**
 * The Orgs the viewer is a Member of, oldest first. `sessclone_own_member_ids()`
 * is the filter, so this is the database answering "who is this" rather than
 * the caller asserting it.
 */
export const listMemberships = (tx: postgres.TransactionSql) =>
  tx<Membership[]>`
    select member.id as member_id, org.name as org_name
      from members member
      join orgs org on org.id = member.org_id
     where member.id in (select sessclone_own_member_ids())
     order by member.created_at
  `

/**
 * Issues a key and returns it in full — the only moment it exists anywhere but
 * in the caller's hands. It is returned, never stored and never logged.
 *
 * A key belongs to one membership, and therefore to one Org: every Turn the
 * Collector reports with it is filed there. One person may be a Member of
 * several Orgs, so when there is a choice to make the caller has to make it —
 * picking the oldest membership silently is how spend lands in the wrong Org
 * and nothing on the screen says so.
 *
 * `memberId` is still not trusted: it is intersected with
 * `sessclone_own_member_ids()`, so naming somebody else's membership inserts
 * nothing.
 */
export const createApiKey = async (
  tx: postgres.TransactionSql,
  label: string,
  memberId?: string,
) => {
  // One membership, no question to ask. Several, and the caller answers it:
  // guessing here is how a key quietly reports a laptop's spend into the wrong
  // Org, with nothing on any screen to say it did.
  let member = memberId
  if (!member) {
    const memberships = await listMemberships(tx)
    if (memberships.length > 1) {
      throw new Error('choose which org this key reports to')
    }
    member = memberships[0]?.member_id
  }
  if (!member) throw new Error('no membership to issue a key for')

  const { key, prefix, hash } = generateApiKey()

  const inserted = await tx`
    insert into api_keys (member_id, label, key_hash, key_prefix)
    select id, ${label}, ${hash}, ${prefix}
      from members
     where id = ${member}
       and id in (select sessclone_own_member_ids())
       -- Ticket 119: no key for an Org waiting for approval or cancelled.
       -- The statuses are UNLOCKED_STATUSES in lib/approval.ts.
       and (${!approvalRequired()}
            or exists (select 1 from subscriptions subscription
                        where subscription.org_id = members.org_id
                          and subscription.status in ('active', 'past_due')))
    returning id
  `

  // The named membership is not the caller's, or the policy refused: say so
  // rather than handing back a key that authenticates nothing.
  if (inserted.length === 0) {
    throw new Error('no membership to issue a key for')
  }

  return key
}

/**
 * The viewer's own keys, newest first. No `where`: `api_keys_own` is the
 * where, and `members_read` is what keeps the join from widening it. Label
 * breaks the tie, because two keys created in one transaction share a
 * `created_at` and an unordered list is a list that reorders itself.
 *
 * The Org comes back with the row so a person in more than one can tell which
 * key reports where — the same reason creating a key now asks.
 */
export const listApiKeys = (tx: postgres.TransactionSql) =>
  tx<ApiKeyRow[]>`
    select key.id, key.label, key.key_prefix, org.name as org_name,
           key.created_at, key.last_used_at, key.revoked_at
      from api_keys key
      join members member on member.id = key.member_id
      join orgs org on org.id = member.org_id
     order by key.created_at desc, key.label
  `

/**
 * Revokes one key. Immediate, because ingest reads `revoked_at` on the next
 * request rather than caching a verdict.
 *
 * `revoked_at is null` keeps a second press from moving the time; the
 * migration's trigger is what keeps it from ever going back to null.
 */
export const revokeApiKey = (tx: postgres.TransactionSql, id: string) =>
  tx`update api_keys set revoked_at = now() where id = ${id} and revoked_at is null`
