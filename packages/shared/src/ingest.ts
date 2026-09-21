import { z } from 'zod'

// Ticket 31. The ingest wire contract, in the one place both ends import it
// from: the Collector builds a payload against this schema and the route
// refuses anything that is not one, so a payload change breaks the build
// rather than production (spec §Packages).
//
// The unit is a **transcript**, not a Turn. A Collector reports what one
// transcript grew by since its cursor, and a queue drain reports several
// transcripts at once — so a payload is one Device, and a report per
// transcript carrying that transcript's Project, its Turns, and the position
// the Collector wants acknowledged.
//
// The credential does not travel in the body. `Authorization: Bearer sk_…` is
// where the key goes, which keeps it out of anything that logs a request body
// and lets the route refuse an unauthenticated caller before it parses one.
//
// The position travels with the report rather than being computed here,
// because only the Collector knows it: the cursor is a `message.id` **and** a
// byte offset into an append-only file (spec §Collector), and the byte offset
// is not recoverable from the Turns. Ingest never interprets it. It echoes
// what it accepted, and the Collector advances to what came back — so a
// response lost in flight re-reports rather than skips, and the unique index
// absorbs the repeat (ADR 0006). Echoing back is also what makes a partially
// refused batch impossible to mistake for a whole one: a 400 acknowledges
// nothing at all.

/**
 * What one request may carry, documented in `docs/configuration.md` because a
 * Collector author is who has to split a drain across requests. Generous
 * rather than tight: the point is that an absurd batch is refused in
 * microseconds with a message that says the limit, not that a real drain is.
 */
export const REPORTS_PER_PAYLOAD = 100
export const TURNS_PER_REPORT = 5000

/** A token count: a non-negative safe integer, or the payload is not one. */
const counter = z.int().min(0)

/**
 * A non-blank string. `min(1)` alone is not that: `"   "` is one character and
 * the tables this feeds — `devices.key`, `projects.key`, `turns.session_id`,
 * `turns.message_id`, `turns.agent_id` — all check `length(btrim(…)) > 0`, so
 * a whitespace-only id passed the boundary and failed at the bottom of the
 * batch instead. The value is not trimmed, only refused: what is stored stays
 * exactly what the Collector reported.
 */
const text = z
  .string()
  .min(1)
  .refine((value) => value.trim() !== '', { error: 'must not be blank' })

/** Present-but-empty is absence spelled differently; both arrive as null. */
const optionalText = z.string().nullable()

export const ReportedUsage = z.object({
  inputTokens: counter,
  outputTokens: counter,
  cacheReadInputTokens: counter,
  cacheCreationInputTokens: counter,
  cacheCreation5mInputTokens: counter,
  cacheCreation1hInputTokens: counter,
  thinkingTokens: counter,
  webSearchRequests: counter,
  webFetchRequests: counter,
})

/**
 * One Turn, exactly as `parseTranscript` produces it. The parser's `Turn` is
 * assignable to this type and `ingest.test.ts` asserts that it stays so — the
 * schema and the parser cannot drift apart without a type error.
 */
export const ReportedTurn = z.object({
  sessionId: text,
  /** Null for a main Session. Never the empty string: ADR 0006's index treats
   * two nulls as equal and a null and an empty string as different, so a
   * caller that spelled absence both ways would store one Turn twice. */
  agentId: text.nullable(),
  messageId: text,
  model: optionalText,
  serviceTier: optionalText,
  speed: optionalText,
  inferenceGeo: optionalText,
  clientVersion: optionalText,
  /** ISO-8601, so a bad clock is a 400 rather than a Postgres error at the
   * bottom of a batch. Null is allowed: an entry may state no timestamp. */
  timestamp: z.iso.datetime({ offset: true }).nullable(),
  cwd: optionalText,
  gitBranch: optionalText,
  requestId: optionalText,
  complete: z.boolean(),
  usage: ReportedUsage,
  entryUuids: z.array(z.string()),
})

/** The last position of this transcript the Collector wants acknowledged. */
export const ReportedCursor = z.object({
  messageId: text,
  byteOffset: counter,
})

export const TranscriptReport = z.object({
  sessionId: text,
  agentId: text.nullable(),
  /** Computed by the Collector with `projectKey`, never by the route: the
   * remote and the working directory live on the reporting machine. */
  project: z.object({ key: text, remote: z.string().nullable() }),
  cursor: ReportedCursor,
  /**
   * Bounded so an absurd report is a 400 naming the limit rather than a
   * request that runs until something times out. The route inserts in chunks,
   * so this ceiling is about the work one request may ask for, not about what
   * a single statement can carry.
   */
  turns: z
    .array(ReportedTurn)
    .max(
      TURNS_PER_REPORT,
      `a report carries at most ${TURNS_PER_REPORT} turns`,
    ),
})

/**
 * A payload names no Member and no Org.
 *
 * Ticket 34 removed the `memberId` this used to carry: both are resolved from
 * the API key in the `Authorization` header, by hash, so the only thing that
 * decides where a Turn is filed is a credential the caller had to hold. A
 * field the caller fills in cannot be that, however carefully it is
 * validated — somebody else's id is a valid id.
 */
export const IngestPayload = z.object({
  /** `deviceKey` from this package; the nickname is the Member's to change. */
  device: z.object({ key: text, nickname: text.nullable().optional() }),
  reports: z
    .array(TranscriptReport)
    .min(1)
    .max(
      REPORTS_PER_PAYLOAD,
      `a batch carries at most ${REPORTS_PER_PAYLOAD} reports`,
    ),
})

export type ReportedUsage = z.infer<typeof ReportedUsage>
export type ReportedTurn = z.infer<typeof ReportedTurn>
export type ReportedCursor = z.infer<typeof ReportedCursor>
export type TranscriptReport = z.infer<typeof TranscriptReport>
export type IngestPayload = z.infer<typeof IngestPayload>

/** What the Collector reads to advance its cursors. */
export type IngestResponse = {
  accepted: {
    sessionId: string
    agentId: string | null
    /** Turns received, not rows inserted: a re-report is accepted and stores
     * nothing, and the Collector's cursor must move either way. */
    turns: number
    cursor: ReportedCursor
  }[]
}
