// Tickets 100-105: the transcript viewer's data model.
//
// A Claude Code transcript is JSONL whose format Claude Code documents as
// internal and liable to change (code.claude.com/docs/en/sessions). So the
// viewer never trusts a shape it has not seen: every line becomes an `Item`,
// and a line it does not understand becomes an `unknown` Item carrying the raw
// object rather than an error.
//
// Two layers, both pure so they run in the browser and in unit tests alike:
//
//   parseLines(lines)               one JSONL line   -> zero or more Items
//   buildTimeline(items)            loaded Items     -> Rows for one column
//
// buildTimeline is re-run over everything loaded so far whenever another chunk
// arrives. The main column loads from the end of the file backwards (HTTP
// Range), so a tool result can be loaded before the tool call it answers;
// pairing therefore happens here, over the whole loaded set, never in
// parseLines.

/** Tokens as the API reported them for one model response. */
export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
}

/** Fields every Item carries. */
type ItemBase = {
  /** `<uuid>` of the line, suffixed `:<n>` when one line yields several Items. */
  id: string
  /** Byte offset of the line in its file; orders Items across chunks. */
  offset: number
  /** ISO timestamp of the line, when it has one. */
  at: string | null
  /** The parsed line, for the details view and the "All" preset. */
  raw: unknown
}

export type Item = ItemBase &
  (
    | { kind: 'user'; text: string }
    | {
        kind: 'assistant'
        text: string
        /** API message id; joins to `turns.message_id` for cost. */
        messageId: string | null
        requestId: string | null
        model: string | null
        effort: string | null
        usage: Usage | null
        stopReason: string | null
      }
    | {
        kind: 'thinking'
        /** Empty when Claude Code stored only a signature. */
        text: string
        messageId: string | null
        model: string | null
        effort: string | null
      }
    | {
        kind: 'tool_use'
        toolUseId: string
        name: string
        input: unknown
        messageId: string | null
        model: string | null
        effort: string | null
      }
    | {
        kind: 'tool_result'
        toolUseId: string
        isError: boolean
        /** Text of the result, blocks joined. */
        text: string
        /** The line's `toolUseResult`, which carries agentId / runId. */
        detail: unknown
      }
    | {
        kind: 'hook'
        /** e.g. PreToolUse, PostToolUse, UserPromptSubmit, SessionStart. */
        event: string
        name: string | null
        command: string | null
        exitCode: number | null
        durationMs: number | null
        /** Failed, or blocked the action it guards. */
        failed: boolean
        output: string
        /** The tool call it ran around, when it names one. */
        toolUseId: string | null
      }
    | { kind: 'compaction'; trigger: string | null; preTokens: number | null }
    | { kind: 'interrupt'; text: string }
    | { kind: 'api_error'; text: string }
    | { kind: 'slash_command'; name: string; args: string }
    /** Skill text, system reminders and the like injected as a user turn. */
    | { kind: 'injected'; text: string }
    /** Every `attachment` line that is not a hook. */
    | { kind: 'attachment'; attachmentType: string; text: string }
    | { kind: 'queue'; operation: string; text: string }
    | { kind: 'unknown'; type: string | null }
  )

export type ItemKind = Item['kind']

/** An Agent Run's status, as far as the loaded files can tell. */
export type RunStatus = 'done' | 'running' | 'died_mid_turn' | 'not_stored'

/**
 * What a column renders. One Row per visible thing, in file order, with
 * pairing and placement already done.
 */
export type Row =
  | { kind: 'item'; item: Item }
  | {
      kind: 'tool'
      use: Extract<Item, { kind: 'tool_use' }>
      result: Extract<Item, { kind: 'tool_result' }> | null
      /** Call to result; null while no result is loaded. */
      durationMs: number | null
      /** Hooks that ran around this call, in order. */
      hooks: Extract<Item, { kind: 'hook' }>[]
    }
  | {
      kind: 'skill'
      use: Extract<Item, { kind: 'tool_use' }>
      skill: string
      result: Extract<Item, { kind: 'tool_result' }> | null
      /** The injected skill text that followed, when loaded. */
      content: Extract<Item, { kind: 'injected' }> | null
    }
  | {
      kind: 'agent'
      use: Extract<Item, { kind: 'tool_use' }>
      result: Extract<Item, { kind: 'tool_result' }> | null
      /** From the result; null until it is loaded. */
      agentId: string | null
      agentType: string | null
      description: string | null
      /** The prompt the parent sent. */
      prompt: string | null
      model: string | null
    }
  | {
      kind: 'workflow'
      use: Extract<Item, { kind: 'tool_use' }>
      result: Extract<Item, { kind: 'tool_result' }> | null
      runId: string | null
      name: string | null
      summary: string | null
    }
  /** Drawn as a rule whenever model or effort differs from the row before. */
  | { kind: 'section'; model: string | null; effort: string | null }

/** One line of a workflow's `journal.jsonl`, as far as the viewer needs it. */
export type JournalAgent = {
  agentId: string
  label: string | null
  phase: string | null
  /** Present once the agent returned. */
  done: boolean
}

/** An agent's `.meta.json` sidecar, as far as the viewer needs it. */
export type AgentMeta = {
  agentType: string | null
  description: string | null
  toolUseId: string | null
  spawnDepth: number | null
  workflowPhase: string | null
  model: string | null
}

/**
 * What a filter chip switches. A preset is a set of these plus a thinking
 * mode; thinking itself is governed by the mode, not a chip.
 */
export const CATEGORIES = [
  'user',
  'assistant',
  'tool',
  'tool_output',
  'skill',
  'agent',
  'workflow',
  'hook',
  'hook_failed',
  'section',
  'compaction',
  'interrupt',
  'api_error',
  'slash_command',
  'injected',
  'attachment',
  'queue',
  'unknown',
] as const

export type Category = (typeof CATEGORIES)[number]

export type ThinkingMode = 'hidden' | 'collapsed' | 'verbose'

export type Preset = {
  categories: Category[]
  thinking: ThinkingMode
}

/** Built in, not editable. Taha's list, 2026-09-23. */
export const NORMAL: Preset = {
  categories: [
    'user',
    'assistant',
    'tool',
    'skill',
    'agent',
    'workflow',
    'hook_failed',
    'section',
    'compaction',
    'interrupt',
    'api_error',
    'slash_command',
  ],
  thinking: 'collapsed',
}

export const ALL: Preset = {
  categories: [...CATEGORIES],
  thinking: 'collapsed',
}
