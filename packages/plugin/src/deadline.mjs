// One clock for everything a hook does, because a hook is killed by one.
//
// Claude Code gives each hook the seconds `hooks.json` asks for and kills it
// at that mark — the Member sees "Hook cancelled" in their session, which is
// alarming and says nothing about what was lost (nothing: the next
// `SessionStart` sweep re-reads from the same cursors).
//
// Checking a budget *between* requests is not enough, which is what shipped
// first and what a real machine caught. A single request has its own timeout —
// eight seconds for an upload, six for a report, plus up to 2.6 in retry
// backoff — so one that starts a second before the budget ends is still in
// flight several seconds after the hook is dead. Every request therefore gets
// the time that is actually left, and none is issued once there is none.

/** A deadline that never arrives, for a caller with no hook around it. */
export const NO_DEADLINE = Number.POSITIVE_INFINITY

/**
 * The shortest timeout worth issuing, in milliseconds.
 *
 * A request given four milliseconds fails as surely as one never sent, but
 * costs a connection to a deployment that is already being asked to hurry. It
 * is the floor rather than a refusal because the request may be the cheap one
 * that completes anyway — a refused presign, an empty report.
 */
const FLOOR_MS = 250

/** A deadline `ms` from now, as an absolute time. */
export const deadlineIn = (ms) => Date.now() + ms

/** Whether a deadline has passed. */
export const expired = (deadline) => Date.now() >= deadline

/**
 * A timeout signal for one request: its own limit, or whatever is left.
 *
 * @param {number} limitMs What this kind of request is allowed at most.
 * @param {number} [deadline] When the caller is out of time altogether.
 */
export const requestSignal = (limitMs, deadline = NO_DEADLINE) =>
  AbortSignal.timeout(
    Math.max(FLOOR_MS, Math.min(limitMs, deadline - Date.now())),
  )
