// The transcript parser. A Turn is one model response — one API call, one
// price — and this is the single place that decision is made, so both of the
// corpus's measured failures are prevented here or nowhere: entries repeat per
// content block and summing them overcounts by 2.4x, and the first block of a
// group is a partial count written mid-stream that undercounts one measured
// turn by 200x.

/** The counters a Turn consumed, exactly as Claude Code reported them. */
export type TurnUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  /** The reported total. Kept beside the split so nothing is inferred. */
  cacheCreationInputTokens: number
  cacheCreation5mInputTokens: number
  cacheCreation1hInputTokens: number
  /** A subset of `outputTokens`, not an addition to it. */
  thinkingTokens: number
  webSearchRequests: number
  webFetchRequests: number
}

export type Turn = {
  sessionId: string
  /** Null for a main Session; an Agent Run carries its parent's session id. */
  agentId: string | null
  messageId: string
  /** `<synthetic>` is a real value here, and null means the entry named none. */
  model: string | null
  serviceTier: string | null
  speed: string | null
  inferenceGeo: string | null
  clientVersion: string | null
  timestamp: string | null
  /**
   * Read off the entry rather than recovered from the transcript's directory
   * name, which replaces every separator with a dash and so cannot be reversed.
   */
  cwd: string | null
  gitBranch: string | null
  requestId: string | null
  /**
   * False when every entry in the group carried `stop_reason: null` — the run
   * died mid-stream, so these counters are a floor rather than a total.
   */
  complete: boolean
  usage: TurnUsage
  /**
   * Every content block's uuid, in file order. Not identity: a fork rewrites
   * `sessionId` and leaves these byte-identical, which is what makes a forked
   * copy recognisable later rather than silently merged now.
   */
  entryUuids: string[]
}

// Only the fields the parser reaches for. An entry carries many more, and the
// redactor decides which survive into a fixture, not this shape.
type Entry = {
  uuid?: string
  sessionId?: string
  agentId?: string
  requestId?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  version?: string
  message?: {
    id?: string
    model?: string
    stop_reason?: string | null
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      cache_creation?: {
        ephemeral_5m_input_tokens?: number
        ephemeral_1h_input_tokens?: number
      }
      output_tokens_details?: { thinking_tokens?: number }
      server_tool_use?: {
        web_search_requests?: number
        web_fetch_requests?: number
      }
      service_tier?: string
      speed?: string
      inference_geo?: string
    }
  }
}

type UsageEntry = Entry & {
  sessionId: string
  message: {
    id: string
    usage: NonNullable<NonNullable<Entry['message']>['usage']>
  }
}

// JSON.parse returns any, so naming the return type here is the one place the
// untyped boundary is crossed — and it is a declaration, not an assertion.
const parseEntry = (line: string): Entry => JSON.parse(line)

const carriesUsage = (entry: Entry): entry is UsageEntry =>
  entry.message?.usage !== undefined &&
  entry.message.id !== undefined &&
  entry.sessionId !== undefined

const maximum = (
  entries: readonly UsageEntry[],
  of: (entry: UsageEntry) => number,
) => entries.reduce((highest, entry) => Math.max(highest, of(entry)), 0)

// A modifier is absent from a partial block and present on the completed one,
// so the group's value is the first entry that states it rather than the first
// entry outright.
const stated = <T>(
  entries: readonly UsageEntry[],
  of: (entry: UsageEntry) => T | null | undefined,
): T | null => {
  for (const entry of entries) {
    const value = of(entry)
    if (value !== undefined && value !== null) return value
  }
  return null
}

const usageOf = (entries: readonly UsageEntry[]): TurnUsage => ({
  inputTokens: maximum(
    entries,
    (entry) => entry.message.usage.input_tokens ?? 0,
  ),
  outputTokens: maximum(
    entries,
    (entry) => entry.message.usage.output_tokens ?? 0,
  ),
  cacheReadInputTokens: maximum(
    entries,
    (entry) => entry.message.usage.cache_read_input_tokens ?? 0,
  ),
  cacheCreationInputTokens: maximum(
    entries,
    (entry) => entry.message.usage.cache_creation_input_tokens ?? 0,
  ),
  cacheCreation5mInputTokens: maximum(
    entries,
    (entry) =>
      entry.message.usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
  ),
  cacheCreation1hInputTokens: maximum(
    entries,
    (entry) =>
      entry.message.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  ),
  thinkingTokens: maximum(
    entries,
    (entry) => entry.message.usage.output_tokens_details?.thinking_tokens ?? 0,
  ),
  webSearchRequests: maximum(
    entries,
    (entry) => entry.message.usage.server_tool_use?.web_search_requests ?? 0,
  ),
  webFetchRequests: maximum(
    entries,
    (entry) => entry.message.usage.server_tool_use?.web_fetch_requests ?? 0,
  ),
})

// A group always holds the entry it was created from, so the type says so and
// nothing has to assert it back.
type Group = [UsageEntry, ...UsageEntry[]]

const turnOf = (entries: Group): Turn => {
  const [first] = entries

  return {
    sessionId: first.sessionId,
    agentId: first.agentId ?? null,
    messageId: first.message.id,
    model: stated(entries, (entry) => entry.message.model),
    serviceTier: stated(entries, (entry) => entry.message.usage.service_tier),
    speed: stated(entries, (entry) => entry.message.usage.speed),
    inferenceGeo: stated(entries, (entry) => entry.message.usage.inference_geo),
    clientVersion: stated(entries, (entry) => entry.version),
    timestamp: stated(entries, (entry) => entry.timestamp),
    cwd: stated(entries, (entry) => entry.cwd),
    gitBranch: stated(entries, (entry) => entry.gitBranch),
    requestId: stated(entries, (entry) => entry.requestId),
    complete: entries.some(
      (entry) =>
        entry.message.stop_reason !== null &&
        entry.message.stop_reason !== undefined,
    ),
    usage: usageOf(entries),
    entryUuids: entries
      .map((entry) => entry.uuid)
      .filter((uuid) => uuid !== undefined),
  }
}

/**
 * Turns one transcript's text into Turns, in the order they first appear.
 *
 * A Turn is produced from entries carrying `message.usage`, keyed on that
 * presence rather than on a list of entry types to skip: the bookkeeping types
 * are open-ended and three of them already carry no uuid and no timestamp.
 */
export const parseTranscript = (text: string): Turn[] => {
  // A kill landing inside a write leaves a half-written entry with no trailing
  // newline. Everything before the last newline was intact in every measured
  // case, so the tail after it is discarded rather than guessed at.
  const complete = text.slice(0, text.lastIndexOf('\n') + 1)

  const groups = new Map<string, Group>()

  for (const line of complete.split('\n')) {
    if (line === '') continue

    let entry: Entry
    try {
      entry = parseEntry(line)
    } catch {
      // A corrupt line mid-file is one lost entry. Failing the whole
      // transcript would lose every other Turn in it, and the Collector
      // re-reports what the unique index then absorbs.
      continue
    }

    if (!carriesUsage(entry)) continue

    const key = `${entry.sessionId}\u0000${entry.agentId ?? ''}\u0000${entry.message.id}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [entry])
    else group.push(entry)
  }

  return [...groups.values()].map(turnOf)
}
