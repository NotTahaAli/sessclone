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
