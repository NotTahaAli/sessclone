import { createHash, randomBytes } from 'node:crypto'

import type postgres from 'postgres'

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
  created_at: Date
  last_used_at: Date | null
  revoked_at: Date | null
}

/**
 * Issues a key and returns it in full — the only moment it exists anywhere but
 * in the caller's hands. It is returned, never stored and never logged.
 *
 * The membership is chosen by `sessclone_own_member_ids()`, which reads the
 * claim on this transaction. That is the database answering "who is this",
 * not the caller asserting it.
 */
export const createApiKey = async (
  tx: postgres.TransactionSql,
  label: string,
) => {
  const { key, prefix, hash } = generateApiKey()

  const inserted = await tx`
    insert into api_keys (member_id, label, key_hash, key_prefix)
    select id, ${label}, ${hash}, ${prefix}
      from members
     where id in (select sessclone_own_member_ids())
     order by created_at
     limit 1
    returning id
  `

  // No membership, or the policy refused: say so rather than handing back a
  // key that authenticates nothing.
  if (inserted.length === 0) {
    throw new Error('no membership to issue a key for')
  }

  return key
}

/**
 * The viewer's own keys, newest first. No `where`: `api_keys_own` is the
 * where. Label breaks the tie, because two keys created in one transaction
 * share a `created_at` and an unordered list is a list that reorders itself.
 */
export const listApiKeys = (tx: postgres.TransactionSql) =>
  tx<ApiKeyRow[]>`
    select id, label, key_prefix, created_at, last_used_at, revoked_at
      from api_keys
     order by created_at desc, label
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
