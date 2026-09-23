import { z } from 'zod'

// Ticket 58. The presign wire contract, in the one place both ends import it
// from — the same arrangement as `ingest.ts`, for the same reason: a change to
// what the Collector sends breaks the build rather than production.
//
// The credential does not travel in the body. `Authorization: Bearer sk_…` is
// where the API key goes, exactly as ingest has it.
//
// **The Project is not in this payload at all.** ADR 0003 is explicit that the
// route resolves the Session to its Project from the Turns already ingested
// and authorises against that: a Collector runs on the Member's machine, so a
// Project key it supplies is a claim, and honouring it would let an excluded
// Project be archived by sending a different key. A field that is ignored is
// worse than no field — it reads as though it were used — so there is none.

// 200 characters, not 500: these two become percent-encoded segments of an
// object key, and a multibyte character encodes to nine bytes. S3's key limit
// is 1024 bytes, and a key that exceeds it is refused *after* the transcript
// has been streamed — the cost ADR 0003's presign-side guard exists to avoid.
const text = z.string().trim().min(1).max(200)

/**
 * What the object is (ticket 104). A Session's transcripts are not its only
 * files: each Agent Run has an `agent-<id>.meta.json` sidecar, and each
 * workflow run a `journal.jsonl`. They ride the same presign and confirm, the
 * same gates and the same hash guard, told apart by this.
 *
 * For `agent_meta` the `agentId` is the Agent Run's id; for
 * `workflow_journal` it is the workflow's run id (`wf_…`).
 *
 * Defaulted, so a Collector that predates it keeps archiving transcripts.
 */
export const ArtifactKind = z
  .enum(['transcript', 'agent_meta', 'workflow_journal'])
  .default('transcript')

export type ArtifactKind = z.output<typeof ArtifactKind>

export const PresignRequest = z.object({
  sessionId: text,
  /** Null for a main Session; an Agent Run's transcript is its own object. */
  agentId: text.nullable().optional(),
  kind: ArtifactKind,
  /** Lowercase hex SHA-256 of the transcript as it stands on disk. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex sha-256'),
})

export type PresignRequest = z.infer<typeof PresignRequest>

/**
 * What the Collector sends once the bytes have landed (ticket 59).
 *
 * The presign route authorises an upload; this one records that it happened.
 * They are two requests because the PUT between them is the part that can
 * fail: a row written at presign time would claim a transcript is stored
 * before it is, and the hash guard would then refuse to ever upload it — the
 * transcript would be permanently missing and the dashboard would say it was
 * there.
 *
 * The object's size is deliberately absent: the deployment reads it from
 * storage, which is the only account of it that a failed or truncated upload
 * cannot overstate.
 */
export const ConfirmRequest = z.object({
  sessionId: text,
  /** Null for a main Session; an Agent Run's transcript is its own object. */
  agentId: text.nullable().optional(),
  kind: ArtifactKind,
  /** Lowercase hex SHA-256 of the bytes that were uploaded. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex sha-256'),
  /**
   * The object key the Collector actually PUT to, as the presign route gave
   * it.
   *
   * Echoed, not trusted: the deployment derives the key again and records only
   * its own. This field exists so the two can be *compared* — a Turn landing
   * under a different Project between the two requests moves the derived key,
   * and a row written then would name one object while carrying another's hash
   * and size, which the unchanged guard would make permanent. When they
   * differ the answer is `stale_key` and the Collector simply presigns again.
   */
  storageKey: z.string().trim().min(1).max(1024),
})

export type ConfirmRequest = z.infer<typeof ConfirmRequest>

/**
 * A recorded upload, a refusal, or an error.
 *
 * `stored` carries the size the deployment read back from storage, so a
 * Collector can tell a recorded upload from a silently truncated one.
 *
 * Two refusals are particular to this route, and both are transient.
 * `not_uploaded` is an object that is not in the bucket — an upload that
 * failed after answering, or a provider that has not made it visible yet.
 * `stale_key` is the Session having moved Project between the presign and the
 * confirm, so the key the bytes went to is no longer the key this Session
 * belongs under. The Collector presigns again in both cases.
 */
export type ConfirmResponse =
  | { stored: true; storageKey: string; sizeBytes: number }
  | { refused: PresignRefusal | 'not_uploaded' | 'stale_key'; detail: string }
  | { error: string; detail?: string }

/**
 * Why a presign was refused, as a code the Collector can branch on.
 *
 * Five of them, distinguishable on purpose (ADR 0003): a Collector that cannot
 * tell "you never opted in" from "this repository is excluded" cannot tell the
 * Member which switch to flip.
 *
 * `no_turns` is the transient one — the Session has not been ingested yet, so
 * its Project cannot be resolved — and the Collector retries rather than
 * telling anybody anything.
 */
export type PresignRefusal =
  | 'unchanged'
  | 'archival_off'
  | 'project_excluded'
  | 'tier_excludes_archival'
  | 'no_turns'

/**
 * A refusal, a URL, or — at 400, 401 and 503 — `{ error, detail? }`: a
 * malformed body, a key that identifies no live Member, and a deployment with
 * no storage configured are the three cases that are not answers to the
 * question the Collector asked.
 */
export type PresignResponse =
  | {
      url: string
      storageKey: string
      /** Seconds. A presigned URL is a bearer credential; it expires. */
      expiresIn: number
      /**
       * The kind this URL was issued for (ticket 104). A deployment older
       * than kinds strips the field from the request and omits it here, and a
       * Collector sends a sidecar only when this echoes the kind it asked for.
       */
      kind: ArtifactKind
    }
  | { refused: PresignRefusal; detail: string }
  | { error: string; detail?: string }
