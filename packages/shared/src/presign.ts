import { z } from 'zod'

import { MAX_SEAL } from './limits.ts'

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

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex sha-256')

/**
 * How the transcript is stored (ADR 0008). `whole` is one object replaced on
 * each upload, as ADR 0003 has it; `chunked` is sealed gzip chunks plus a raw
 * tail. Whole-file is the zero-chunk case of chunked, not a second layout.
 *
 * Defaulted, so a Collector that predates it keeps the whole-file path. Only
 * a `transcript` chunks: the deployment answers any other kind as `whole`.
 */
export const Layout = z.enum(['whole', 'chunked']).default('whole')

export type Layout = z.output<typeof Layout>

/** Re-exported: the Collector reads it from the zod-free `limits.ts`. */
export { MAX_SEAL }

export const PresignRequest = z
  .object({
    sessionId: text,
    /** Null for a main Session; an Agent Run's transcript is its own object. */
    agentId: text.nullable().optional(),
    kind: ArtifactKind,
    /** Lowercase hex SHA-256 of the transcript as it stands on disk. */
    sha256,
    layout: Layout,
    /**
     * The chunks this pass seals (ADR 0008), as the Collector planned them:
     * one PUT URL each, from the next seq, and the tail URL after them. Each
     * chunk's key is built from its raw SHA-256, so different bytes never
     * share a key. Absent is the steady-state turn — one tail URL.
     */
    seal: z
      .array(z.object({ seq: z.number().int().min(1), sha256 }))
      .min(1)
      .max(MAX_SEAL)
      .optional(),
  })
  .refine(
    (request) => request.seal === undefined || request.layout === 'chunked',
    {
      message: 'seal is only meaningful with layout: chunked',
      path: ['seal'],
    },
  )

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
export const ConfirmRequest = z
  .object({
    sessionId: text,
    /** Null for a main Session; an Agent Run's transcript is its own object. */
    agentId: text.nullable().optional(),
    kind: ArtifactKind,
    /** Lowercase hex SHA-256 of every raw byte stored, chunks and tail. */
    sha256,
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
    layout: Layout,
    /**
     * The chunks this pass sealed, in seq order (ADR 0008). The raw offsets,
     * lengths and hashes are the Collector's word, as `sha256` is; the stored
     * sizes are read back from storage.
     */
    chunks: z
      .array(
        z.object({
          seq: z.number().int().min(1),
          // Bounded, because both feed `size_bytes`: 2^50 is a petabyte of
          // transcript, and a chunk is cut at about 1 MiB, so 256 MiB is a
          // single line no transcript writes. The confirm also checks each
          // length against the stored size it read back.
          rawOffset: z
            .number()
            .int()
            .min(0)
            .lt(2 ** 50),
          rawLength: z
            .number()
            .int()
            .min(1)
            .max(256 * 1024 * 1024),
          sha256,
        }),
      )
      .max(MAX_SEAL)
      .optional(),
    /** SHA-256 of the raw bytes `[0, sealed bytes)` once these chunks are in. */
    sealedSha256: sha256.optional(),
  })
  .refine(
    (request) =>
      request.layout === 'chunked' ||
      (request.chunks === undefined && request.sealedSha256 === undefined),
    {
      message: 'chunks are only meaningful with layout: chunked',
      path: ['chunks'],
    },
  )
  .refine(
    (request) => !request.chunks?.length || request.sealedSha256 !== undefined,
    {
      message: 'a sealing confirm names its new prefix hash',
      path: ['sealedSha256'],
    },
  )

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
 *
 * `stale_chunks` (ADR 0008) is a chunked confirm that no longer follows on
 * from what is sealed: the first new chunk does not start at the row's sealed
 * bytes or next seq, the seqs are not contiguous, or the tail key is not the
 * one derived for the chunks that would then be sealed. Also transient.
 *
 * `sizeBytes` is always raw bytes — chunks plus tail — which is what a
 * download yields.
 */
export type ConfirmResponse =
  | { stored: true; storageKey: string; sizeBytes: number }
  | {
      refused: PresignRefusal | 'not_uploaded' | 'stale_key' | 'stale_chunks'
      detail: string
    }
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
      /**
       * ADR 0008. Present only when `layout: 'chunked'` was asked for on a
       * transcript and this deployment chunks. A missing echo means the
       * whole-file path: `url` is then the whole file's.
       */
      layout?: 'chunked'
      /**
       * What the row already holds sealed: raw bytes, the SHA-256 of raw
       * `[0, bytes)` (null when nothing is sealed), and how many chunks. The
       * Collector re-hashes that prefix locally; a mismatch or a shorter file
       * means it falls back to `layout: 'whole'`.
       */
      sealed?: { bytes: number; sha256: string | null; chunks: number }
      /**
       * One PUT URL per chunk asked for with `seal`, from seq `chunks + 1`.
       * `url`/`storageKey` above are then the tail's after them.
       */
      seals?: { seq: number; url: string; storageKey: string }[]
    }
  | { refused: PresignRefusal; detail: string }
  | { error: string; detail?: string }
