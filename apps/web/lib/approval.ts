import type { SubscriptionStatus } from './tier'

// Ticket 119: a new Org is locked until an operator approves it.
//
// Taha's picks, 2026-09-23. `inactive` and no subscription row at all (the
// state every Org starts in, and every Org that was never activated before
// this shipped) lock the Org, and so does `cancelled`. `past_due` does not:
// it keeps the banner ticket 48 gave it, and everything keeps working. A
// locked Org sees one page ("Waiting for approval" or "Cancelled") and Sign
// out; it cannot create a key, and ingest answers its keys with the same 401
// as any bad key.
//
// On by default, self-hosted deployments included. `SIGNUP_APPROVAL=off`
// turns the lock off for a deployment that has no operator to approve
// anybody — then every status behaves as it did under ticket 48.
//
// The switch is read per call rather than at module load, so a test can
// flip it and a restarted process picks up a changed value.

/** Whether the deployment requires an operator to approve an Org. */
export const approvalRequired = () =>
  process.env.SIGNUP_APPROVAL?.trim().toLowerCase() !== 'off'

/** The statuses that are never locked. SQL states the same pair; keep them
 * together (`lib/api-keys.ts`, `lib/collector-auth.ts`). */
export const UNLOCKED_STATUSES = ['active', 'past_due'] as const

/** Whether an Org with this status (null: no row) is locked right now. */
export const isLocked = (status: SubscriptionStatus | null): boolean =>
  approvalRequired() &&
  !(UNLOCKED_STATUSES as readonly (string | null)[]).includes(status)
