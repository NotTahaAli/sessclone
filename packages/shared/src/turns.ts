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

// A string, not merely a present key: a null or numeric `message.id` would
// group two separate API calls under one Turn and discard the smaller, and it
// would put a null into the column the unique index is built on.
const carriesUsage = (entry: Entry): entry is UsageEntry =>
  entry.message?.usage !== undefined &&
  typeof entry.message.id === 'string' &&
  entry.message.id !== '' &&
  typeof entry.sessionId === 'string' &&
  entry.sessionId !== ''

// An Agent Run's id, or null for a main Session. An empty string is absence
// written differently and must not become an id of its own.
const agentIdOf = (entry: Entry): string | null =>
  typeof entry.agentId === 'string' && entry.agentId !== ''
    ? entry.agentId
    : null

// A counter is a count. A transcript is a file on a Member's machine on the
// path to an Org's bill, and `NaN` or `Infinity` reaching a Cost would
// serialise to null and price nothing at all, so anything that is not a
// non-negative safe integer is read as absent.
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0

// A group always holds the entry it was created from, so the type says so and
// nothing has to assert it back.
type Group = [UsageEntry, ...UsageEntry[]]

const maximum = (
  entries: readonly UsageEntry[],
  of: (entry: UsageEntry) => unknown,
) => entries.reduce((highest, entry) => Math.max(highest, count(of(entry))), 0)

// The entry that reported the most cache creation. Its two classes are read
// together with its total, so the priced classes always explain the number
// they are priced against: maximising each of the three independently can
// compose a block no entry ever reported — two blocks that disagree about
// which class the tokens fell in yield 20,330 five-minute tokens beside
// 24,982 one-hour tokens against a reported total of 24,982.
const largestCacheCreation = (entries: Group) =>
  entries.reduce((highest, entry) =>
    count(entry.message.usage.cache_creation_input_tokens) >
    count(highest.message.usage.cache_creation_input_tokens)
      ? entry
      : highest,
  )

const finished = (entry: UsageEntry) =>
  entry.message.stop_reason !== null && entry.message.stop_reason !== undefined

// A modifier comes from a block the parser is willing to trust. apiBlockIndex 0
// is the partial write the counters already refuse to believe — it is missing
// `speed` entirely on one measured turn — so a block carrying a stop reason
// answers first, and only if none does is the group read in file order.
const stated = <T>(
  entries: readonly UsageEntry[],
  of: (entry: UsageEntry) => T | null | undefined,
): T | null => {
  for (const entry of [...entries.filter(finished), ...entries]) {
    const value = of(entry)
    if (value !== undefined && value !== null) return value
  }
  return null
}

const usageOf = (entries: Group): TurnUsage => {
  const cacheCreation = largestCacheCreation(entries).message.usage

  return {
    inputTokens: maximum(entries, (entry) => entry.message.usage.input_tokens),
    outputTokens: maximum(
      entries,
      (entry) => entry.message.usage.output_tokens,
    ),
    cacheReadInputTokens: maximum(
      entries,
      (entry) => entry.message.usage.cache_read_input_tokens,
    ),
    cacheCreationInputTokens: count(cacheCreation.cache_creation_input_tokens),
    // Read from the same entry as the total above. Where that entry states no
    // split at all, the classes are zero against a non-zero total — a
    // shortfall a Cost can notice, rather than an overcount it cannot.
    cacheCreation5mInputTokens: count(
      cacheCreation.cache_creation?.ephemeral_5m_input_tokens,
    ),
    cacheCreation1hInputTokens: count(
      cacheCreation.cache_creation?.ephemeral_1h_input_tokens,
    ),
    thinkingTokens: maximum(
      entries,
      (entry) => entry.message.usage.output_tokens_details?.thinking_tokens,
    ),
    webSearchRequests: maximum(
      entries,
      (entry) => entry.message.usage.server_tool_use?.web_search_requests,
    ),
    webFetchRequests: maximum(
      entries,
      (entry) => entry.message.usage.server_tool_use?.web_fetch_requests,
    ),
  }
}

const turnOf = (entries: Group): Turn => {
  const [first] = entries

  return {
    sessionId: first.sessionId,
    agentId: agentIdOf(first),
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
    complete: entries.some(finished),
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
  const groups = new Map<string, Group>()

  for (const line of text.split('\n')) {
    if (line === '') continue

    let entry: Entry
    try {
      entry = parseEntry(line)
    } catch {
      // Two cases, one answer. A kill landing inside a write leaves a
      // half-written entry at the end of the file, and finding 05's rule is to
      // discard it — a torn entry is a prefix of a JSON object, so it never
      // parses and is dropped here. A corrupt line mid-file is dropped the same
      // way: failing the whole transcript would lose every other Turn in it,
      // and the Collector re-reports what the unique index then absorbs.
      //
      // Testing the tail by whether it parses rather than by whether a newline
      // follows it is the one deviation from that finding, and it is strictly
      // safer: a complete final entry whose newline has not landed yet is a
      // whole Turn, and truncating to the last newline drops it for good on a
      // transcript that never grows again.
      continue
    }

    if (!carriesUsage(entry)) continue

    const key = `${entry.sessionId}\u0000${agentIdOf(entry) ?? ''}\u0000${entry.message.id}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [entry])
    else group.push(entry)
  }

  return [...groups.values()].map(turnOf)
}
