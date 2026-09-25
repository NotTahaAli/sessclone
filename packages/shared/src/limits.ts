// Re-exported from inside the plugin, for the reason `turns.ts` gives: a hook
// can only import what the install copied, and an install copies
// `packages/plugin` alone.
export {
  FAILURE_MESSAGE_LIMIT,
  FAILURES_PER_PAYLOAD,
  MAX_SEAL,
  REPORTS_PER_PAYLOAD,
  TURNS_PER_REPORT,
} from '../../plugin/src/shared/limits.ts'
