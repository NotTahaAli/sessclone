// Tickets 35 and 36: finding every transcript one Session wrote.
//
// A Session is not one file. Finding 06 recorded the layout on macOS, Linux
// and Windows and finding 74 confirmed it inside Claude Projects:
//
//   <config>/projects/<sanitised-cwd>/<sessionId>.jsonl        the Session
//   <config>/projects/<sanitised-cwd>/<sessionId>/
//       subagents/agent-<agentId>.jsonl                        an Agent Run
//       subagents/agent-<agentId>.meta.json                     its sidecar
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
  environment = process.env,
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

  for (const directory of directories) {
    const main = join(directory, `${sessionId}.jsonl`)
    // eslint-disable-next-line no-await-in-loop -- one stat per project directory
    if (await isFile(main)) {
      found.set(main, { path: main, agentRun: false, spawnDepth: null })
    }

    const runs = join(directory, sessionId, 'subagents')
    // eslint-disable-next-line no-await-in-loop -- as above
    for (const name of await list(runs)) {
      if (!name.endsWith('.jsonl')) continue
      const path = join(runs, name)
      found.set(path, {
        path,
        // Which run it is comes from the entries, which name their own
        // `agentId`; the filename is only where to look.
        agentRun: true,
        // eslint-disable-next-line no-await-in-loop -- one read per Agent Run
        spawnDepth: await spawnDepthOf(path),
      })
    }
  }

  if (transcriptPath && !found.has(transcriptPath)) {
    found.set(transcriptPath, {
      path: transcriptPath,
      agentRun: false,
      spawnDepth: null,
    })
  }

  return [...found.values()]
}
