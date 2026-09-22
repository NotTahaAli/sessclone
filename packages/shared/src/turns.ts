// The transcript parser lives in `packages/plugin/src/shared/`, and this file
// re-exports it.
//
// Not where it belongs conceptually, and deliberately so. A Claude Code plugin
// is installed by copying its own directory — `packages/plugin` and nothing
// else — into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. A
// hook that imports a path leaving that directory therefore resolves to
// nothing on every installed machine, which is what
// `../../shared/src/turns.ts` did: `session-start.mjs` swallowed the resulting
// `ERR_MODULE_NOT_FOUND` and every install collected silently nothing.
//
// So the three modules a hook loads at runtime — this one, `identity` and
// `limits` — live inside the plugin, where an install carries them, and the
// web app reaches them from here. This direction costs a re-export; the other
// direction cost every Collector.
export { parseTranscript } from '../../plugin/src/shared/turns.ts'
export type { Turn, TurnUsage } from '../../plugin/src/shared/turns.ts'
