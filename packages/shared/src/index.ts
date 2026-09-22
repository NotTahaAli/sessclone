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
export { PresignRequest } from './presign.ts'
export type { PresignRefusal, PresignResponse } from './presign.ts'
