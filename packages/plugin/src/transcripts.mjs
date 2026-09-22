// Tickets 35 and 36: finding every transcript one Session wrote.
//
// A Session is not one file. Finding 06 recorded the layout on macOS, Linux
// and Windows and finding 74 confirmed it inside Claude Projects:
//
//   <config>/projects/<sanitised-cwd>/<sessionId>.jsonl        the Session
//   <config>/projects/<sanitised-cwd>/<sessionId>/
//       subagents/agent-<agentId>.jsonl                        an Agent Run
//       subagents/agent-<agentId>.meta.json                     its sidecar
//       subagents/workflows/<runId>/agent-<agentId>.jsonl      a workflow's run
//
// `subagents/` is walked rather than listed, because a workflow's runs sit a
// level deeper under their run id (spec §Hooks, verified live) and finding 06
// says the same in glob form: `projects/*/**/*.jsonl` finds them, a flat
// listing of `subagents/` misses every one.
//
// Every subagent run — a workflow's runs included, which are the same files in
// the same place — writes its own transcript one level deeper, carrying the
// *parent's* `sessionId` beside its own `agentId`. A Collector that reports
// only the file the hook names drops all of it, and that is billed usage.
//
// The directory is searched rather than derived, for two reasons: the
// sanitised directory name replaces every separator with a dash and so cannot
// be reversed (finding 06), and a Session whose working directory changed
// mid-run has written under more than one of them (finding 74).

import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Where Claude Code keeps its transcripts, per finding 06: `CLAUDE_CONFIG_DIR`
 * when set, `~/.claude` otherwise, on all three platforms.
 *
 * @param {Record<string, string | undefined>} environment
 */
export const configDirectory = (environment = process.env) =>
  environment.CLAUDE_CONFIG_DIR?.trim() ||
  join(environment.HOME?.trim() || homedir(), '.claude')

/** A directory listing, or nothing: an absent directory is not an error. */
const list = async (directory) => {
  try {
    return await readdir(directory)
  } catch {
    return []
  }
}

/**
 * How far under `subagents/` a transcript may sit.
 *
 * An ordinary run is directly inside it; a workflow's runs are one level
 * deeper, under their run id. Bounded rather than unbounded because this walks
 * a directory a Member's machine wrote and a Stop hook has ten seconds.
 */
const RUN_DEPTH = 3

/**
 * Every `.jsonl` under `directory`, to `depth` levels. Missing is empty.
 *
 * @param {string} directory
 * @param {number} depth
 * @returns {Promise<string[]>}
 */
const walk = async (directory, depth) => {
  if (depth <= 0) return []

  const entries = await readdirOrNothing(directory)
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return walk(path, depth - 1)
      return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
    }),
  )
  return found.flat()
}

/** A listing with file types, or nothing: an absent directory is not an error. */
const readdirOrNothing = async (directory) => {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

const isFile = async (path) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * The spawn depth of one Agent Run, read from its sidecar.
 *
 * Read rather than assumed: a run spawned by a run is deeper than one, the
 * number lives in `agent-<id>.meta.json` beside the transcript (finding 06),
 * and it is absent on some runs — which is why the column is nullable.
 */
const spawnDepthOf = async (transcript) => {
  try {
    const meta = JSON.parse(
      await readFile(transcript.replace(/\.jsonl$/, '.meta.json'), 'utf8'),
    )
    return Number.isInteger(meta.spawnDepth) && meta.spawnDepth >= 0
      ? meta.spawnDepth
      : null
  } catch {
    return null
  }
}

/**
 * Every transcript belonging to `sessionId`: its own, and one per Agent Run.
 *
 * The hook's own `transcript_path` is always included, even when the search
 * cannot see it — a Member with a `CLAUDE_CONFIG_DIR` this process does not
 * know about still gets their Session reported, just without its Agent Runs.
 *
 * @param {object} input
 * @param {string | undefined} input.transcriptPath From the hook event.
 * @param {string} input.sessionId
 * @param {Record<string, string | undefined>} input.environment
 * @returns {Promise<{ path: string, agentRun: boolean, spawnDepth: number | null }[]>}
 */
export const sessionTranscripts = async ({
  transcriptPath,
  sessionId,
  environment,
}) => {
  const projects = join(configDirectory(environment), 'projects')

  const directories = new Set(
    (await list(projects)).map((entry) => join(projects, entry)),
  )
  // The directory the hook named, which is the one this Session is writing to
  // right now — and which a non-default config directory can keep out of the
  // listing above.
  if (transcriptPath) directories.add(dirname(transcriptPath))

  /** Keyed by path: one Session can be reached through two of the above. */
  const found = new Map()

  const perDirectory = await Promise.all(
    [...directories].map(async (directory) => {
      const here = []

      const main = join(directory, `${sessionId}.jsonl`)
      if (await isFile(main)) {
        here.push({ path: main, agentRun: false, spawnDepth: null })
      }

      const runs = join(directory, sessionId, 'subagents')
      const transcripts = await walk(runs, RUN_DEPTH)
      here.push(
        ...(await Promise.all(
          transcripts.map(async (path) => ({
            path,
            // Which run it is comes from the entries, which name their own
            // `agentId`; the filename is only where to look.
            agentRun: true,
            spawnDepth: await spawnDepthOf(path),
          })),
        )),
      )

      return here
    }),
  )

  for (const file of perDirectory.flat()) found.set(file.path, file)

  if (transcriptPath && !found.has(transcriptPath)) {
    found.set(transcriptPath, {
      path: transcriptPath,
      agentRun: false,
      spawnDepth: null,
    })
  }

  return [...found.values()]
}
