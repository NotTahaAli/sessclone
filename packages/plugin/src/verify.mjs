// Tickets 68, 69 and 70: the evidence a person collects by hand, gathered by a
// machine so the person only has to run one command and paste what it prints.
//
// None of these three tickets can be automated — they need a real macOS, a
// real Windows, a real cloud container, and real Claude Code sessions. What
// *can* be automated is the part that is otherwise transcription: which Node
// is running, where the cursor and the queue actually landed, which Device key
// this environment resolves to, how deep the subagent transcripts sit, and
// whether a day's Turns counted from the transcripts match the dashboard.
//
// Two rules shaped this file:
//
// **It never prints a secret.** A transcript of the session it runs in is
// exactly the kind of artifact this product uploads, and a person will paste
// the output into a chat. The key is reported as its first three characters
// and its length, which is what `configuration.mjs` already decided is safe,
// and nothing else from the environment is echoed verbatim except values the
// Member typed themselves (`SESSCLONE_URL`, `SESSCLONE_DEVICE`).
//
// **It reuses the Collector's own modules.** A second implementation of "where
// does the state directory go" would pass while the real one was broken, which
// is the one failure this script exists to catch.

import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { hostname as osHostname, release, type as osType } from 'node:os'
import { join } from 'node:path'

import { deviceKey } from '../../shared/src/identity.ts'
import { parseTranscript } from '../../shared/src/turns.ts'
import {
  ConfigurationError,
  MINIMUM_NODE,
  defaultStateDir,
  nodeProblem,
  readConfiguration,
} from './configuration.mjs'
import { configDirectory, sessionTranscripts } from './transcripts.mjs'

/** How many of the newest Sessions are opened for their Agent Runs. */
const SESSIONS_INSPECTED = 20

/** How long the reachability probe waits before giving up. */
const PROBE_TIMEOUT_MS = 5000

const listing = async (directory) => {
  try {
    return await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * What can be said about the key without saying the key.
 *
 * @param {string | undefined} raw
 */
export const keyEvidence = (raw) => {
  const key = raw?.trim()
  if (!key) return { set: false }
  return { set: true, prefix: key.slice(0, 3), length: key.length }
}

/**
 * True when this Linux is really Windows wearing a kernel.
 *
 * Worth asking because the two resolve different state directories — WSL takes
 * the XDG path, native Windows takes `LOCALAPPDATA` — and a report that says
 * only "linux" cannot tell ticket 68's Windows row from its Linux one.
 *
 * @param {string} procVersion Contents of `/proc/version`, or ''.
 */
export const isWsl = (procVersion) => /microsoft/i.test(procVersion)

/** A directory's entry count and newest modification time, or absence. */
const directoryEvidence = async (directory) => {
  const entries = await listing(directory)
  if (entries.length === 0) {
    // An empty directory and a missing one are different answers to "did the
    // Collector ever run here", so they are told apart rather than merged.
    let exists = false
    try {
      exists = (await stat(directory)).isDirectory()
    } catch {
      exists = false
    }
    return { path: directory, exists, entries: 0, newest: null }
  }

  // A cursor directory holds one file per Session and per Agent Run, so the
  // stats are the many. Zero for an entry swept between the listing and the
  // stat, which then loses the `Math.max` rather than throwing.
  const times = await Promise.all(
    entries.map(async (entry) => {
      try {
        return (await stat(join(directory, entry.name))).mtimeMs
      } catch {
        return 0
      }
    }),
  )
  const newest = Math.max(0, ...times)

  return {
    path: directory,
    exists: true,
    entries: entries.length,
    newest: newest === 0 ? null : new Date(newest).toISOString(),
  }
}

/**
 * Whether the Collector could write where it thinks it can.
 *
 * A directory that does not exist yet is not a permission problem — it is what
 * a machine looks like before the first session after the restart, which is
 * exactly when a person runs this. Reporting that as "not writable" would send
 * them hunting for a permission they have. Nothing is created here: a check
 * that leaves state behind cannot be run twice and mean the same thing.
 */
const writable = async (directory) => {
  try {
    await stat(directory)
  } catch {
    return { writable: null, problem: 'not created yet' }
  }

  const probe = join(directory, `.verify-${process.pid}`)
  try {
    await writeFile(probe, '')
    await unlink(probe)
    return { writable: true, problem: null }
  } catch (error) {
    return { writable: false, problem: error?.code ?? 'unknown' }
  }
}

/**
 * Where the plugin was installed, as paths rather than as a yes.
 *
 * "Installed" is the claim this whole exercise is testing, so the evidence is
 * the directory Claude Code actually created and the version inside it — not a
 * boolean derived from the same guess the installer made.
 *
 * @param {Record<string, string | undefined>} environment
 */
const installEvidence = async (environment) => {
  const root = join(configDirectory(environment), 'plugins')
  /** @type {{ path: string, version: string | null }[]} */
  const found = []

  const walk = async (directory, depth) => {
    if (depth > 3) return
    const entries = (await listing(directory)).filter((entry) =>
      entry.isDirectory(),
    )

    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name)
        if (/sessclone/i.test(entry.name)) {
          let version = null
          try {
            version = JSON.parse(
              await readFile(join(path, 'package.json'), 'utf8'),
            ).version
          } catch {
            // A marketplace checkout rather than the plugin itself.
          }
          found.push({ path, version: version ?? null })
        }
        await walk(path, depth + 1)
      }),
    )
  }

  await walk(root, 0)
  return { root, found }
}

/**
 * The transcripts this environment has written, and the two shapes finding 74
 * warned about: a Session with runs nested deeper than one level, and a
 * Session written under more than one project directory.
 *
 * @param {Record<string, string | undefined>} environment
 */
const transcriptEvidence = async (environment) => {
  const projects = join(configDirectory(environment), 'projects')

  /** @type {Map<string, { directories: Set<string>, mtimeMs: number }>} */
  const sessions = new Map()

  const directories = (await listing(projects)).filter((entry) =>
    entry.isDirectory(),
  )

  const sighted = await Promise.all(
    directories.map(async (entry) => {
      const directory = join(projects, entry.name)
      const files = (await listing(directory)).filter(
        (file) => file.isFile() && file.name.endsWith('.jsonl'),
      )

      return Promise.all(
        files.map(async (file) => {
          let mtimeMs = 0
          try {
            mtimeMs = (await stat(join(directory, file.name))).mtimeMs
          } catch {
            // Swept between the listing and the stat.
          }
          return {
            sessionId: file.name.replace(/\.jsonl$/, ''),
            directory: entry.name,
            mtimeMs,
          }
        }),
      )
    }),
  )

  // Folded after the reads rather than during them: one Session id can be
  // written under two project directories (finding 74), and that is the thing
  // this function is looking for.
  for (const file of sighted.flat()) {
    const seen = sessions.get(file.sessionId) ?? {
      directories: new Set(),
      mtimeMs: 0,
    }
    seen.directories.add(file.directory)
    seen.mtimeMs = Math.max(seen.mtimeMs, file.mtimeMs)
    sessions.set(file.sessionId, seen)
  }

  const moved = [...sessions]
    .filter(([, seen]) => seen.directories.size > 1)
    .map(([sessionId, seen]) => ({
      sessionId,
      directories: [...seen.directories],
    }))

  // Only the newest few are opened: `sessionTranscripts` walks the subagent
  // tree per Session, and a year of history would turn a one-command check
  // into a minute of disk.
  const newest = [...sessions]
    .toSorted(([, a], [, b]) => b.mtimeMs - a.mtimeMs)
    .slice(0, SESSIONS_INSPECTED)

  const opened = await Promise.all(
    newest.map(([sessionId]) =>
      sessionTranscripts({
        transcriptPath: undefined,
        sessionId,
        environment,
      }),
    ),
  )

  const runs = opened.flat().filter((file) => file.agentRun)
  const agentRuns = runs.length
  const deepestRun = Math.max(0, ...runs.map((file) => file.spawnDepth ?? 0))

  return {
    directory: projects,
    sessions: sessions.size,
    newest:
      newest.length === 0 ? null : new Date(newest[0][1].mtimeMs).toISOString(),
    inspected: newest.length,
    agentRuns,
    deepestRun,
    movedBetweenProjects: moved,
  }
}

/**
 * Whether the deployment answers at all, with no key attached.
 *
 * This separates "the Collector cannot reach the deployment" from "the
 * deployment refused the report", which the install guide calls out as the two
 * failures that look identical from a Member's chair. A plain GET of the base
 * URL is enough for that and carries nothing secret, so the answer is safe to
 * paste.
 *
 * @param {string} url
 */
const reachable = async (url) => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return { reached: true, status: response.status, error: null }
  } catch (error) {
    return {
      reached: false,
      status: null,
      // The name, not the message: a message can carry a resolved URL with a
      // query string on it.
      error: error?.name ?? 'Error',
    }
  }
}

/**
 * Everything tickets 68 and 69 ask a person to observe, in one object.
 *
 * @param {object} [input]
 * @param {Record<string, string | undefined>} [input.environment]
 * @param {NodeJS.Platform} [input.platform]
 * @param {string} [input.hostname]
 * @param {boolean} [input.probe] Contact the deployment. On by default.
 */
export const collect = async ({
  environment = process.env,
  platform = process.platform,
  hostname = osHostname(),
  probe = true,
} = {}) => {
  let procVersion = ''
  try {
    procVersion = await readFile('/proc/version', 'utf8')
  } catch {
    // Not Linux, or a Linux without procfs.
  }

  /** @type {import('./configuration.mjs').CollectorConfiguration | null} */
  let configuration = null
  /** @type {string[]} */
  let problems = []
  try {
    configuration = readConfiguration(environment, platform)
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error
    problems = error.problems
  }

  // The state directory is reported even when the configuration was refused —
  // the commonest refusal is a missing key, and where the cursor and the queue
  // landed is ticket 68's acceptance criterion whether or not one is set. So
  // the default is resolved here rather than read off a configuration that may
  // not exist.
  const stateDir =
    configuration?.stateDir ??
    environment.SESSCLONE_STATE_DIR?.trim() ??
    defaultStateDir(platform, environment) ??
    null

  const state = stateDir
    ? {
        path: stateDir,
        ...(await writable(stateDir).catch(() => ({
          writable: false,
          problem: 'unknown',
        }))),
        cursors: await directoryEvidence(join(stateDir, 'cursors')),
        queue: await directoryEvidence(join(stateDir, 'queue')),
      }
    : null

  return {
    at: new Date().toISOString(),
    machine: {
      platform,
      wsl: platform === 'linux' && isWsl(procVersion),
      os: `${osType()} ${release()}`,
      node: process.versions.node,
      nodeProblem: nodeProblem(process.versions.node),
      minimumNode: MINIMUM_NODE.join('.'),
    },
    configuration: {
      problems,
      key: keyEvidence(environment.SESSCLONE_API_KEY),
      url: configuration?.url ?? environment.SESSCLONE_URL?.trim() ?? null,
      urlDefaulted: !environment.SESSCLONE_URL?.trim(),
      device: environment.SESSCLONE_DEVICE?.trim() ?? null,
      // The key this Member's Turns will be filed under. Ticket 69's "every
      // container collapses into one Device" is this string being equal across
      // containers, so it is printed rather than described.
      deviceKey: deviceKey({ hostname, environment }),
    },
    install: await installEvidence(environment),
    state,
    transcripts: await transcriptEvidence(environment),
    deployment:
      probe && configuration?.url ? await reachable(configuration.url) : null,
  }
}

/**
 * The day a timestamp belongs to, in the Org's own timezone.
 *
 * Ticket 70 reconciles "one day", and the dashboard's day is the Org's
 * timezone (ticket 51) rather than this machine's. Counting in UTC here and
 * comparing against a dashboard in Karachi is a discrepancy the ticket would
 * then ask us to trace, so the timezone is a parameter.
 *
 * @param {string} timestamp
 * @param {string} timeZone
 */
export const dayOf = (timestamp, timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))

/**
 * A hand count of Turns, keyed the way the database keys them.
 *
 * `turns_identity_key` is `(member_id, session_id, agent_id, message_id)` with
 * nulls not distinct, so two reports of the same Turn collapse into one row.
 * Counting the same way locally is what makes "repeated sweeps produce no
 * duplicate Turns" checkable: the dashboard shows unique identities, so that
 * is the number to compare, and `parsed - unique` is what a re-read of the
 * same transcript would have added if the index were not there.
 *
 * @param {import('../../shared/src/turns.ts').Turn[]} turns
 * @param {{ day: string | null, timeZone: string }} window
 */
export const reconcile = (turns, { day, timeZone }) => {
  /** @type {Map<string, import('../../shared/src/turns.ts').Turn>} */
  const unique = new Map()
  let parsed = 0
  let undated = 0

  for (const turn of turns) {
    if (turn.timestamp === null) {
      undated += 1
      // An entry with no timestamp cannot be placed in a day, so it is counted
      // and excluded rather than silently dropped into the window.
      if (day !== null) continue
    } else if (day !== null && dayOf(turn.timestamp, timeZone) !== day) {
      continue
    }

    parsed += 1
    unique.set(
      `${turn.sessionId}|${turn.agentId ?? ''}|${turn.messageId}`,
      turn,
    )
  }

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  }
  /** @type {Map<string, number>} */
  const byModel = new Map()
  let incomplete = 0

  for (const turn of unique.values()) {
    totals.inputTokens += turn.usage.inputTokens
    totals.outputTokens += turn.usage.outputTokens
    totals.cacheReadInputTokens += turn.usage.cacheReadInputTokens
    totals.cacheCreationInputTokens += turn.usage.cacheCreationInputTokens
    if (!turn.complete) incomplete += 1
    const model = turn.model ?? '(none)'
    byModel.set(model, (byModel.get(model) ?? 0) + 1)
  }

  return {
    day,
    timeZone,
    parsed,
    unique: unique.size,
    duplicates: parsed - unique.size,
    undated,
    incomplete,
    totals,
    byModel: [...byModel].toSorted((a, b) => b[1] - a[1]),
  }
}

/**
 * Every transcript under the config directory, including Agent Runs.
 *
 * Deliberately not `allSessions`, which lists one level and so sees no
 * subagent transcript (finding 74 measured those one *and two* levels deeper).
 * A reconciliation that missed them would undercount and the ticket would send
 * us hunting for a cause that was the counter all along.
 *
 * @param {Record<string, string | undefined>} environment
 */
export const everyTranscript = async (environment) => {
  const projects = join(configDirectory(environment), 'projects')
  let entries = []
  try {
    entries = await readdir(projects, {
      withFileTypes: true,
      recursive: true,
    })
  } catch {
    return []
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) =>
      join(entry.parentPath ?? entry.path ?? projects, entry.name),
    )
}

/**
 * Counts a day of Turns off this machine's transcripts.
 *
 * @param {object} input
 * @param {string | null} input.day `YYYY-MM-DD`, or null for everything.
 * @param {string} input.timeZone
 * @param {Record<string, string | undefined>} [input.environment]
 */
export const handCount = async ({
  day,
  timeZone,
  environment = process.env,
}) => {
  const paths = await everyTranscript(environment)
  /** @type {import('../../shared/src/turns.ts').Turn[]} */
  const turns = []
  let unreadable = 0

  // One transcript at a time, deliberately. A day of sessions is tens of
  // megabytes of JSON and this is the one place that holds parsed Turns from
  // every file at once; reading them all in parallel would hold every file's
  // text as well, on a laptop, for no gain — the parse, not the read, is the
  // cost here.
  for (const path of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose: see above
      turns.push(...parseTranscript(await readFile(path, 'utf8')))
    } catch {
      unreadable += 1
    }
  }

  return {
    ...reconcile(turns, { day, timeZone }),
    transcripts: paths.length,
    unreadable,
  }
}

const yesNo = (value) => (value ? 'yes' : 'no')

/**
 * One line for the cursor directory or the queue directory.
 *
 * An empty directory and a missing one read differently on purpose: the first
 * says the Collector has run here, the second that it has not.
 *
 * @param {string} name
 * @param {{ path: string, exists: boolean, entries: number, newest: string | null }} evidence
 */
const directoryLine = (name, evidence) =>
  `- ${name}: \`${evidence.path}\` — ${
    evidence.exists ? `${evidence.entries} file(s)` : 'does not exist'
  }${evidence.newest ? `, newest ${evidence.newest}` : ''}`

/**
 * The report as a block a person pastes back, rather than as JSON they have to
 * be talked through. Markdown because that is what the thread renders.
 *
 * @param {Awaited<ReturnType<typeof collect>>} report
 */
export const format = (report) => {
  const lines = []
  const say = (line = '') => lines.push(line)

  say(`## sessclone install check — ${report.at}`)
  say()
  say('| | |')
  say('| --- | --- |')
  say(
    `| Platform | ${report.machine.platform}${report.machine.wsl ? ' (WSL)' : ''} — ${report.machine.os} |`,
  )
  say(
    `| Node | ${report.machine.node}${report.machine.nodeProblem ? ` — **too old**, needs ${report.machine.minimumNode}+` : ' — ok'} |`,
  )
  say(`| Device key | \`${report.configuration.deviceKey}\` |`)
  say(
    `| URL | ${report.configuration.url ?? '(none)'}${report.configuration.urlDefaulted ? ' — **defaulted**, SESSCLONE_URL is not set' : ''} |`,
  )
  say(
    `| Key | ${
      report.configuration.key.set
        ? `starts "${report.configuration.key.prefix}", ${report.configuration.key.length} characters`
        : '**not set**'
    } |`,
  )
  if (report.deployment) {
    say(
      `| Deployment | ${report.deployment.reached ? `answered ${report.deployment.status}` : `**unreachable** (${report.deployment.error})`} |`,
    )
  }

  say()
  if (report.configuration.problems.length > 0) {
    say('**The Collector refused this configuration:**')
    say()
    for (const problem of report.configuration.problems) say(`- ${problem}`)
    say()
  }

  say('### Install')
  say()
  if (report.install.found.length === 0) {
    say(`Nothing matching \`sessclone\` under \`${report.install.root}\`.`)
  } else {
    for (const found of report.install.found) {
      say(`- \`${found.path}\`${found.version ? ` — ${found.version}` : ''}`)
    }
  }

  say()
  say('### State directory')
  say()
  if (!report.state) {
    say('Could not be resolved on this platform.')
  } else {
    say(
      `\`${report.state.path}\` — ${
        report.state.writable === null
          ? report.state.problem
          : `writable: ${yesNo(report.state.writable)}${report.state.problem ? ` (${report.state.problem})` : ''}`
      }`,
    )
    say()
    say(directoryLine('Cursors', report.state.cursors))
    say(directoryLine('Queue', report.state.queue))
  }

  say()
  say('### Transcripts')
  say()
  say(`- \`${report.transcripts.directory}\``)
  say(
    `- ${report.transcripts.sessions} session(s), newest ${report.transcripts.newest ?? 'none'}`,
  )
  say(
    `- ${report.transcripts.agentRuns} agent run transcript(s) across the newest ${report.transcripts.inspected}, deepest nesting ${report.transcripts.deepestRun}`,
  )
  if (report.transcripts.movedBetweenProjects.length > 0) {
    say(
      `- ${report.transcripts.movedBetweenProjects.length} session(s) written under more than one project directory:`,
    )
    for (const moved of report.transcripts.movedBetweenProjects.slice(0, 5)) {
      say(`  - \`${moved.sessionId}\` → ${moved.directories.join(', ')}`)
    }
  } else {
    say('- No session written under more than one project directory')
  }

  return lines.join('\n')
}

/**
 * The reconciliation as a block, for ticket 70.
 *
 * @param {Awaited<ReturnType<typeof handCount>>} count
 */
export const formatCount = (count) => {
  const lines = []
  const say = (line = '') => lines.push(line)

  say(
    `## sessclone hand count — ${count.day ?? 'every day'} (${count.timeZone})`,
  )
  say()
  say('| | |')
  say('| --- | --- |')
  say(
    `| Transcripts read | ${count.transcripts}${count.unreadable ? ` (${count.unreadable} unreadable)` : ''} |`,
  )
  say(`| Turns in window | ${count.parsed} |`)
  say(
    `| **Unique Turns — compare this with the dashboard** | **${count.unique}** |`,
  )
  say(`| Repeats collapsed by identity | ${count.duplicates} |`)
  say(`| Turns with no timestamp (excluded) | ${count.undated} |`)
  say(
    `| Turns cut off mid-stream (counters are a floor) | ${count.incomplete} |`,
  )
  say(`| Input tokens | ${count.totals.inputTokens.toLocaleString('en-GB')} |`)
  say(
    `| Output tokens | ${count.totals.outputTokens.toLocaleString('en-GB')} |`,
  )
  say(
    `| Cache read | ${count.totals.cacheReadInputTokens.toLocaleString('en-GB')} |`,
  )
  say(
    `| Cache write | ${count.totals.cacheCreationInputTokens.toLocaleString('en-GB')} |`,
  )

  say()
  say('### By model')
  say()
  for (const [model, turns] of count.byModel) say(`- ${model}: ${turns}`)

  return lines.join('\n')
}
