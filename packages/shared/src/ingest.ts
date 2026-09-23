import { z } from 'zod'

import {
  FAILURE_MESSAGE_LIMIT,
  FAILURES_PER_PAYLOAD,
  REPORTS_PER_PAYLOAD,
  TURNS_PER_REPORT,
} from './limits.ts'

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

// The limits live in `limits.ts`, which imports nothing: the Collector chunks
// to them and cannot import this file, because its hooks run without zod.
export {
  FAILURE_MESSAGE_LIMIT,
  FAILURES_PER_PAYLOAD,
  REPORTS_PER_PAYLOAD,
  TURNS_PER_REPORT,
}

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
  /**
   * How deep the Agent Run that produced this Turn was spawned, read by the
   * Collector from the sidecar beside the run's transcript (tickets 35, 36).
   * Optional as well as nullable, and deliberately so: the parser produces a
   * `Turn` without this field, and the Collector attaches it only for the
   * Turns of an Agent Run. A payload that omits it is a main Session's.
   */
  spawnDepth: counter.nullable().optional(),
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
 * A turn that ended on an API error rather than on an answer (ticket 40).
 *
 * The `StopFailure` hook carries the error type, optional details and the
 * rendered error line — and nothing else about the conversation. None of the
 * prompt travels here: `last_assistant_message` on this event is the API error
 * string, not Claude's output (Claude Code hooks reference, `StopFailure`),
 * which is what makes this collectable without the transcript's consent gate.
 *
 * `errorType` is free text rather than an enum of the eleven types the
 * reference lists. A type this version has never heard of is exactly the case
 * worth recording, and refusing the payload for it would also throw away the
 * Turns riding in the same request. Bounded instead, and stored as it came.
 */
export const ReportedFailure = z.object({
  sessionId: text,
  /** The Agent Run that failed, when it was one. */
  agentId: text.nullable().optional(),
  /** When the hook fired. The Collector's clock, because the event states no
   * time — and a stable one, so a re-sent failure is the same row: it is part
   * of `session_events_identity_key`. */
  occurredAt: z.iso.datetime({ offset: true }),
  errorType: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => value.trim() !== '', { error: 'must not be blank' }),
  message: z.string().max(FAILURE_MESSAGE_LIMIT).nullable().optional(),
})

/**
 * A session that ended (ticket 38). The completeness record: the `SessionEnd`
 * hook reports it so a later sweep knows this Session is done and need not be
 * re-read.
 *
 * It is deliberately server-side — a row in `session_events` — rather than a
 * local marker beside the cursor. A local one would be written on the machine
 * that ran the session and lost with it, which is exactly the case a sweep
 * exists for: a container reclaimed by `SIGKILL` fires no `SessionEnd` at all
 * (finding 05), so the record never being written *is* the signal of an
 * abnormal end, and that signal has to outlive the container to be read. The
 * cost is one small row per clean session end; the cost of a killed container
 * is a Session that is never marked complete and so is re-read until its cursor
 * goes stale, which is bandwidth, never a lost Turn.
 */
export const ReportedSessionEnd = z.object({
  sessionId: text,
  /** The Collector's clock: `SessionEnd` carries no time, and a stable value
   * makes a re-sent marker the same `session_events` row. */
  occurredAt: z.iso.datetime({ offset: true }),
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
export const IngestPayload = z
  .object({
    /** `deviceKey` from this package; the nickname is the Member's to change. */
    device: z.object({ key: text, nickname: text.nullable().optional() }),
    reports: z
      .array(TranscriptReport)
      .max(
        REPORTS_PER_PAYLOAD,
        `a batch carries at most ${REPORTS_PER_PAYLOAD} reports`,
      ),
    /** Empty for every ordinary report: only the `StopFailure` hook fills it. */
    failures: z
      .array(ReportedFailure)
      .max(
        FAILURES_PER_PAYLOAD,
        `a batch carries at most ${FAILURES_PER_PAYLOAD} failures`,
      )
      .optional(),
    /** The `SessionEnd` completeness marker, when this request carries one. */
    sessionEnd: ReportedSessionEnd.optional(),
  })
  // `reports` lost its `min(1)` to this: a failed turn and a bare session end
  // both produce no Turn, so those hooks send reports of their own or none at
  // all. What is still refused is a request carrying nothing at all, which
  // would be a Device upsert dressed as a report.
  .refine(
    (payload) =>
      payload.reports.length +
        (payload.failures?.length ?? 0) +
        (payload.sessionEnd ? 1 : 0) >
      0,
    { error: 'a batch carries at least one report, failure or session end' },
  )

export type ReportedUsage = z.infer<typeof ReportedUsage>
export type ReportedTurn = z.infer<typeof ReportedTurn>
export type ReportedCursor = z.infer<typeof ReportedCursor>
export type ReportedFailure = z.infer<typeof ReportedFailure>
export type ReportedSessionEnd = z.infer<typeof ReportedSessionEnd>
export type TranscriptReport = z.infer<typeof TranscriptReport>
export type IngestPayload = z.infer<typeof IngestPayload>

/**
 * What the Collector reads to advance its cursors. A schema rather than a bare
 * type so the OpenAPI spec (`openapi.ts`, ticket 117) describes the 200 from
 * the same definition the route builds it against.
 */
export const IngestResponse = z.object({
  accepted: z.array(
    z.object({
      sessionId: z.string(),
      agentId: z.string().nullable(),
      /** Turns received, not rows inserted: a re-report is accepted and
       * stores nothing, and the Collector's cursor must move either way. */
      turns: counter,
      cursor: ReportedCursor,
    }),
  ),
})

export type IngestResponse = z.infer<typeof IngestResponse>
