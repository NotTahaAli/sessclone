// What one ingest request may carry. Here rather than in `ingest.ts` because
// both ends need the numbers and only one end can afford zod: the Collector's
// hooks run as `node <file>` inside an installed plugin, where
// `packages/shared`'s TypeScript is imported directly (Node ≥22.18 strips the
// types) and a `zod` import would not resolve. A file with no imports of its
// own is one both ends can read, so the Collector chunks to the same limits
// the route validates against instead of duplicating the literals.
//
// Generous rather than tight: the point is that an absurd batch is refused in
// microseconds with a message naming the limit, not that a real drain is.
// `docs/configuration.md` documents both, because a Collector author is who
// has to split a drain across requests.

export const REPORTS_PER_PAYLOAD = 100
export const TURNS_PER_REPORT = 5000

/**
 * Stop failures in one request (ticket 40). One hook fires one failure, so
 * this bounds a drain rather than an ordinary report — and it is separate from
 * `REPORTS_PER_PAYLOAD` because a failure carries no Turns and costs one row.
 */
export const FAILURES_PER_PAYLOAD = 100

/**
 * How much of an API error message is stored. Long enough for the rendered
 * error and a retry-after line, short enough that a pathological body cannot
 * be pushed into the table through it.
 */
export const FAILURE_MESSAGE_LIMIT = 2000

/**
 * The most chunks one archival pass may seal (ADR 0008), so a confirm HEADs
 * at most 17 objects. Here rather than in `presign.ts` so the Collector, which
 * cannot import zod, seals to the same cap the route validates.
 */
export const MAX_SEAL = 16
