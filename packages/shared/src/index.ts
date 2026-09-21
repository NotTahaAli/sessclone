// Types and helpers shared between the web app and the Collector plugin.
export { redactEntry } from './redact.ts'
export { parseTranscript } from './turns.ts'
export type { Turn, TurnUsage } from './turns.ts'
export { deviceKey, normaliseRemote, projectKey } from './identity.ts'
export type { ProjectIdentity } from './identity.ts'
export {
  IngestPayload,
  REPORTS_PER_PAYLOAD,
  TURNS_PER_REPORT,
  ReportedCursor,
  ReportedTurn,
  ReportedUsage,
  TranscriptReport,
} from './ingest.ts'
export type { IngestResponse } from './ingest.ts'
