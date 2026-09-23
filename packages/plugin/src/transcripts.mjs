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
//       subagents/workflows/<runId>/journal.jsonl              its journal
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
import { basename, dirname, join } from 'node:path'

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
 * Every `.jsonl` and `.meta.json` under `directory`, to `depth` levels.
 * Missing is empty.
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
      return entry.isFile() &&
        (entry.name.endsWith('.jsonl') || entry.name.endsWith('.meta.json'))
        ? [path]
        : []
    }),
  )
  return found.flat()
}

/**
 * Ticket 104: what a file under `subagents/` is when it is not a transcript,
 * read from its name alone — or null for a transcript.
 *
 * `agent-<id>.meta.json` is an Agent Run's sidecar, keyed by the run's id.
 * `workflows/<runId>/journal.jsonl` is a workflow's journal, keyed by its run
 * id: `.jsonl` like a transcript, but its lines are the workflow's own record
 * of what it started and what came back, not a conversation.
 *
 * @param {string} path
 * @returns {{ kind: 'agent_meta' | 'workflow_journal', agentId: string } | null}
 */
export const sidecarOf = (path) => {
  const name = basename(path)
  const meta = /^agent-(.+)\.meta\.json$/.exec(name)
  if (meta) return { kind: 'agent_meta', agentId: meta[1] }
  if (
    name === 'journal.jsonl' &&
    basename(dirname(dirname(path))) === 'workflows'
  ) {
    return { kind: 'workflow_journal', agentId: basename(dirname(path)) }
  }
  return null
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
 * How many transcripts are `stat`ed at once.
 *
 * A machine can hold thousands of sessions (finding 06), and one `stat` per
 * file all in flight at once is thousands of open descriptors inside a hook —
 * `EMFILE` on a laptop with a modest `ulimit`. A bounded window keeps the
 * descriptor count flat while still overlapping the I/O.
 */
const STAT_CONCURRENCY = 64

/**
 * Every main-session transcript this environment has written, newest first.
 *
 * A main transcript is a `<sessionId>.jsonl` sitting directly in a project
 * directory — not an Agent Run, which lives under `<sessionId>/subagents/`.
 * The SessionStart sweep (ticket 39) walks these and re-reports each from its
 * cursor: a session whose final `Stop` never landed, and the whole history
 * that predates a fresh install, are both just sessions with an unflushed tail
 * or no cursor at all.
 *
 * Newest first and *not* capped: the sweep is time-boxed rather than
 * count-limited (see `sweep` in `report.mjs`), so returning the whole list and
 * letting the budget decide is what keeps "re-report every incomplete session
 * in full" honest as far as the ten seconds reach. Newest first because a
 * recently active session is the one with an unflushed tail worth recovering
 * first, and because once it is flushed its cursor is at the end and the next
 * sweep skips it cheaply — so a large backlog (a fresh install over a year of
 * history) is worked oldest-ward across successive starts rather than lost.
 * `sessionTranscripts` still finds each session's Agent Runs when reported.
 *
 * @param {Record<string, string | undefined>} environment
 * @returns {Promise<{ sessionId: string, transcriptPath: string }[]>}
 */
export const allSessions = async (environment) => {
  const projects = join(configDirectory(environment), 'projects')
  const directories = (await list(projects)).map((entry) =>
    join(projects, entry),
  )

  // The (directory, file) pairs first, from a listing per directory — the
  // directories are few, so those readdirs may all run at once. The `stat`s
  // are the many, and they are what the window below bounds.
  const listings = await Promise.all(
    directories.map(async (directory) => {
      const entries = await readdirOrNothing(directory)
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => ({
          sessionId: entry.name.replace(/\.jsonl$/, ''),
          transcriptPath: join(directory, entry.name),
        }))
    }),
  )
  const files = listings.flat()

  const sighted = []
  for (let at = 0; at < files.length; at += STAT_CONCURRENCY) {
    // eslint-disable-next-line no-await-in-loop -- bounded window: one chunk of stats in flight at a time, so the descriptor count stays flat
    const chunk = await Promise.all(
      files.slice(at, at + STAT_CONCURRENCY).map(async (file) => {
        let mtimeMs = 0
        try {
          mtimeMs = (await stat(file.transcriptPath)).mtimeMs
        } catch {
          // Swept between the listing and the stat: treat as oldest.
        }
        return { ...file, mtimeMs }
      }),
    )
    sighted.push(...chunk)
  }

  // One session id can be written under two project directories (a changed
  // working directory, finding 74). Keep the newest sighting of each; the
  // sweep's own `sessionTranscripts` re-finds every directory when it reports.
  const newest = new Map()
  for (const session of sighted) {
    const seen = newest.get(session.sessionId)
    if (!seen || session.mtimeMs > seen.mtimeMs) {
      newest.set(session.sessionId, session)
    }
  }

  return [...newest.values()]
    .toSorted((a, b) => b.mtimeMs - a.mtimeMs)
    .map(({ sessionId, transcriptPath }) => ({ sessionId, transcriptPath }))
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
export const sessionTranscripts = async (input) =>
  (await sessionFiles(input)).transcripts

/**
 * Every file belonging to `sessionId`, in one walk: the transcripts
 * {@link sessionTranscripts} returns, and the sidecars beside them (ticket
 * 101) — each run's `.meta.json` and each workflow's `journal.jsonl`.
 *
 * @param {object} input
 * @param {string | undefined} input.transcriptPath From the hook event.
 * @param {string} input.sessionId
 * @param {Record<string, string | undefined>} input.environment
 */
export const sessionFiles = async ({
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
  /** @type {Map<string, { path: string, kind: 'agent_meta' | 'workflow_journal', agentId: string }>} */
  const sidecars = new Map()

  const perDirectory = await Promise.all(
    [...directories].map(async (directory) => {
      const here = []

      const main = join(directory, `${sessionId}.jsonl`)
      if (await isFile(main)) {
        here.push({ path: main, agentRun: false, spawnDepth: null })
      }

      const runs = join(directory, sessionId, 'subagents')
      const files = await walk(runs, RUN_DEPTH)
      const transcripts = []
      for (const path of files) {
        const sidecar = sidecarOf(path)
        if (sidecar) sidecars.set(path, { path, ...sidecar })
        else if (path.endsWith('.jsonl')) transcripts.push(path)
      }
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

  return { transcripts: [...found.values()], sidecars: [...sidecars.values()] }
}
