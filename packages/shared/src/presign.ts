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

const text = z.string().trim().min(1).max(500)

export const PresignRequest = z.object({
  sessionId: text,
  /** Null for a main Session; an Agent Run's transcript is its own object. */
  agentId: text.nullable().optional(),
  /** Lowercase hex SHA-256 of the transcript as it stands on disk. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'a lowercase hex sha-256'),
  sizeBytes: z.int().min(0),
})

export type PresignRequest = z.infer<typeof PresignRequest>

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

export type PresignResponse =
  | {
      url: string
      storageKey: string
      /** Seconds. A presigned URL is a bearer credential; it expires. */
      expiresIn: number
    }
  | { refused: PresignRefusal; detail: string }
