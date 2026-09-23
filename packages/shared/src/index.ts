// Types and helpers shared between the web app and the Collector plugin.
export { redactEntry } from './redact.ts'
export { parseTranscript } from './turns.ts'
export type { Turn, TurnUsage } from './turns.ts'
export { deviceKey, normaliseRemote, projectKey } from './identity.ts'
export type { ProjectIdentity } from './identity.ts'
export {
  FAILURE_MESSAGE_LIMIT,
  FAILURES_PER_PAYLOAD,
  IngestPayload,
  REPORTS_PER_PAYLOAD,
  TURNS_PER_REPORT,
  ReportedCursor,
  ReportedFailure,
  ReportedSessionEnd,
  ReportedTurn,
  ReportedUsage,
  TranscriptReport,
} from './ingest.ts'
export type { IngestResponse } from './ingest.ts'
export { ArtifactKind, ConfirmRequest, PresignRequest } from './presign.ts'
export type {
  ConfirmResponse,
  PresignRefusal,
  PresignResponse,
} from './presign.ts'
// Tickets 103-108: the transcript viewer's parser and data model.
export { splitChunk } from './transcript/chunk.ts'
export type { Line } from './transcript/chunk.ts'
export { parseJournal, parseLines, parseMeta } from './transcript/parse.ts'
export {
  buildTimeline,
  categoryOf,
  summarizeRun,
  visibleRows,
} from './transcript/timeline.ts'
export type { RunSummary } from './transcript/timeline.ts'
export { ALL, CATEGORIES, NORMAL } from './transcript/types.ts'
export type {
  AgentMeta,
  Category,
  Item,
  ItemKind,
  JournalAgent,
  Preset,
  Row,
  RunStatus,
  ThinkingMode,
  Usage,
} from './transcript/types.ts'
