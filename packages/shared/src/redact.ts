// Fixture transcripts are real Claude Code sessions, so they carry source
// code, file paths and sometimes credentials. Redaction is an allowlist: a
// key survives only by being named here. A future Claude Code version that
// adds a field is redacted by default rather than leaking into a committed
// fixture — the cost is that a new usage field goes missing until someone
// adds it, which the tests say out loud.
const KEEP_ENTRY = new Set([
  'type',
  'uuid',
  'parentUuid',
  'sessionId',
  'agentId',
  'requestId',
  'timestamp',
  'apiBlockIndex',
  'subtype',
  'isSidechain',
  'isMeta',
  'userType',
  'entrypoint',
  'version',
  'gitBranch',
  'promptId',
  // cwd is what tells a session that changed directory from two sessions
  // sharing an id, and `operation` is the queue enum that distinguished a
  // nested run from its parent. Both are Claude Code's own vocabulary, not
  // anything a person or the model wrote.
  'cwd',
  'operation',
  // Compaction. The boundary's own parentUuid is null and the chain back to
  // the turn before it lives in logicalParentUuid, so anything walking the
  // parent chain needs both. compactMetadata carries the token counts a
  // compaction dropped, which is cost evidence, not content.
  'logicalParentUuid',
  // Uuid pointers, kept so the corpus can still falsify a claim made about
  // them: finding 03 concludes there is no fork-provenance field, and
  // `leafUuid` is the shape one would take. Redacting them away would have
  // made that claim unfalsifiable from the fixtures.
  'leafUuid',
  'sourceToolAssistantUUID',
  'compactMetadata',
  'isCompactSummary',
  'isVisibleInTranscriptOnly',
])

const KEEP_MESSAGE = new Set(['id', 'role', 'model', 'stop_reason', 'usage'])

// A string's length rides along, so a fixture keeps the size of what it
// replaced and a parser test still meets a realistic entry. Nothing else gets
// a length: `JSON.stringify(true).length` is 4 every time, so a length on a
// boolean recovers the boolean, and on a short enum it narrows it to a
// handful of candidates. The allowlist exists to stop exactly that.
const placeholder = (value: unknown) =>
  typeof value === 'string' ? `[redacted:${value.length}]` : '[redacted]'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// A block keeps only what says which block it is and which tool call it
// belongs to. Its payload — prose, thinking, tool arguments, tool output —
// is the part that carries the code and the credentials.
const KEEP_BLOCK = new Set(['type', 'id', 'name', 'tool_use_id', 'is_error'])

const redactBlock = (block: unknown) => {
  if (!isRecord(block)) return block
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(block)) {
    // Replace, never drop — the same rule the entry level follows. Dropping
    // left every thinking block in the corpus as a bare `{"type":"thinking"}`,
    // a shape Claude Code never writes, so a parser test met a block that
    // does not exist and a future block field would have vanished unseen.
    out[key] = KEEP_BLOCK.has(key) ? value : placeholder(value)
  }
  return out
}

const redactMessage = (message: unknown) => {
  if (!isRecord(message)) return message
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(message)) {
    if (KEEP_MESSAGE.has(key)) out[key] = value
  }
  // A compaction summary writes message.content as a plain string rather
  // than a block array, so the array case is not the only one.
  if (Array.isArray(message.content))
    out.content = message.content.map(redactBlock)
  else if ('content' in message) out.content = placeholder(message.content)
  return out
}

// An attachment is a bookkeeping entry: what kind it is, and which hook or
// tool it belongs to, are the facts a parser test needs. Everything else it
// holds is captured output — command lines, stdout, file contents, system
// prompts — and none of that belongs in a committed fixture.
const KEEP_ATTACHMENT = new Set([
  'type',
  'hookEvent',
  'hookName',
  'toolUseID',
  'exitCode',
  'durationMs',
])

const redactAttachment = (attachment: unknown) => {
  if (!isRecord(attachment)) return attachment
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attachment)) {
    out[key] = KEEP_ATTACHMENT.has(key) ? value : placeholder(value)
  }
  return out
}

export const redactEntry = (entry: unknown): unknown => {
  if (!isRecord(entry)) return entry
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    // Unknown keys are replaced rather than dropped. A dropped key is
    // invisible; a placeholder is a fixture saying out loud that this
    // release writes a field nobody has classified yet.
    out[key] = KEEP_ENTRY.has(key) ? value : placeholder(value)
  }
  if ('message' in entry) out.message = redactMessage(entry.message)
  if ('attachment' in entry) out.attachment = redactAttachment(entry.attachment)
  return out
}
