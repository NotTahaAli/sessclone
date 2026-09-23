import type { TransactionSql } from 'postgres'

// Tickets 105-107: what the transcript viewer reads from the database.
//
// Nothing here names a Role. `log_artifacts_read` and `turns_read` are both
// `sessclone_visible_member_ids()`, and the explicit `member_id in (...)` below
// restates that set only so the planner can reach the `(member_id,
// session_id, …)` unique indexes — the policy is still what decides.

export type ArtifactKind = 'transcript' | 'agent_meta' | 'workflow_journal'

export type TranscriptFileRow = {
  id: string
  kind: ArtifactKind
  /** Null for the main Session; the workflow runId for a `workflow_journal`. */
  agentId: string | null
  sizeBytes: number
  uploadedAt: Date
  storageKey: string
}

/** Every stored file of one Session the viewer may read, in one statement. */
export const transcriptFiles = async (
  tx: TransactionSql,
  sessionId: string,
): Promise<TranscriptFileRow[]> => {
  const rows = await tx<
    {
      id: string
      kind: ArtifactKind
      agent_id: string | null
      size_bytes: string
      uploaded_at: Date
      storage_key: string
    }[]
  >`
    select id, kind, agent_id, size_bytes, uploaded_at, storage_key
      from log_artifacts
     where session_id = ${sessionId}
       and member_id in (select sessclone_visible_member_ids())
     order by agent_id nulls first, kind
  `
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    agentId: row.agent_id,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at,
    storageKey: row.storage_key,
  }))
}

export type TurnCost = {
  /** Null, never zero, when a quantity the Turn consumed has no Rate. */
  costUsd: number | null
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheRead: number
  /** The reported cache-creation total; the 5m/1h splits are subsets of it. */
  cacheWrite: number
}

/**
 * The key a Turn is filed under: `<agentId>:<messageId>`, with an empty agent
 * for the main Session. Message ids are only unique within one transcript, so
 * an Agent Run reusing one would otherwise overwrite its parent's.
 */
export const costKey = (agentId: string | null, messageId: string) =>
  `${agentId ?? ''}:${messageId}`

/**
 * The priced Turns of one Session, main and Agent Runs alike, in one
 * statement. The Rate is resolved by `turn_costs` (ADR 0002), joined on the
 * Turn's id so the view prices only this Session's rows.
 */
export const sessionTurnCosts = async (
  tx: TransactionSql,
  sessionId: string,
): Promise<Record<string, TurnCost>> => {
  const rows = await tx<
    {
      agent_id: string | null
      message_id: string
      model: string | null
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens: number
      cache_creation_input_tokens: number
      cost_usd: string | null
    }[]
  >`
    select turn.agent_id, turn.message_id, turn.model, turn.input_tokens,
           turn.output_tokens, turn.cache_read_input_tokens,
           turn.cache_creation_input_tokens, cost.cost_usd
      from turns turn
      join turn_costs cost on cost.turn_id = turn.id
     where turn.session_id = ${sessionId}
       and turn.member_id in (select sessclone_visible_member_ids())
  `
  return Object.fromEntries(
    rows.map((row) => [
      costKey(row.agent_id, row.message_id),
      {
        costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
        model: row.model,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheRead: row.cache_read_input_tokens,
        cacheWrite: row.cache_creation_input_tokens,
      },
    ]),
  )
}
