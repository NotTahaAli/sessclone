// Re-exported from inside the plugin, for the reason `turns.ts` gives: a hook
// can only import what the install copied, and an install copies
// `packages/plugin` alone.
export {
  deviceKey,
  normaliseRemote,
  projectKey,
  withoutEmbeddedCredentials,
} from '../../plugin/src/shared/identity.ts'
export type { ProjectIdentity } from '../../plugin/src/shared/identity.ts'
