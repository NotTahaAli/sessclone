// Ticket 32: the one setup step a Member performs per machine, read once and
// checked once.
//
// Plain `.mjs` rather than TypeScript, and that is the whole reason this file
// is not `configuration.ts` beside `index.ts`. The hooks in `hooks/` are run
// by Claude Code as `node <file>` with no bundler and no build step in
// between, so anything they import has to be runnable JavaScript. A TypeScript
// module here would mean a build, and a build means a plugin that is broken
// until somebody remembers to run it.
//
// `docs/configuration.md` is the contract for every variable below, and
// `packages/shared/src/configuration.test.ts` already fails if that document
// and `.env.example` disagree. What is added here is the third leg: the values
// are *checked*, at session start, rather than being read for the first time
// by a report that fails at midnight into a log nobody reads.

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * `sk_` and 32 random bytes, base64url — 43 characters after the prefix.
 * `apps/web/lib/api-keys.ts` is what issues them, and this pattern is that
 * function's output written as a check: a key that cannot have come from it
 * cannot verify against it either, so there is no reason to wait for a server
 * to say so.
 *
 * Deliberately a shape check and nothing more. Whether a well-formed key is
 * *live* is ingest's question (ticket 34) and is not answerable from here.
 */
const KEY_PATTERN = /^sk_[\w-]{43}$/

/** What the Collector reports to when nobody says otherwise. */
export const DEFAULT_URL = 'http://127.0.0.1:3000'

/**
 * The oldest Node that can run the Collector.
 *
 * The hooks import two modules from `packages/shared` as TypeScript and rely
 * on Node executing them by stripping the types, which is on by default from
 * 22.18 (and in 23.6 on the other line). Older Node throws
 * `Unknown file extension ".ts"` from inside a hook, where every failure is
 * swallowed — so a Member on Node 20 would see a plugin that installs, starts
 * cleanly and silently reports nothing. Checked once, at session start, where
 * it can be said out loud.
 */
export const MINIMUM_NODE = [22, 18]

/**
 * A sentence naming the Node problem, or null.
 *
 * @param {string} version `process.versions.node`.
 */
export const nodeProblem = (version) => {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  const [wantMajor, wantMinor] = MINIMUM_NODE
  const old =
    major < wantMajor || (major === wantMajor && minor < wantMinor) ||
    // The 23 line never received type stripping by default before 23.6.
    (major === 23 && minor < 6)
  return old
    ? `Node ${version} is too old for the Collector, which needs ${wantMajor}.${wantMinor} or newer (or 24). Nothing will be collected from this machine until Claude Code runs on a newer Node.`
    : null
}

/**
 * Raised when the environment cannot produce a usable configuration.
 *
 * `problems` is a sentence per variable, and **none of them ever carries a
 * value read from `SESSCLONE_API_KEY`.** That is the acceptance criterion
 * about the key never reaching a log or a transcript, and an error message is
 * the likeliest place for it to leak: a hook's stderr is printed in the
 * session, and a session is a transcript this product then uploads.
 */
export class ConfigurationError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(problems.join(' '))
    this.name = 'ConfigurationError'
    this.problems = problems
  }
}

/**
 * Where the cursor and the retry queue live, per platform.
 *
 * Never under `~/.claude`: Claude Code's own `cleanupPeriodDays` sweep deletes
 * everything under `~/.claude/projects/` after 30 days, which would take the
 * cursor and the queue with it (finding 06).
 *
 * @param {NodeJS.Platform} platform
 * @param {Record<string, string | undefined>} env
 */
const defaultStateDir = (platform, env) => {
  if (platform === 'win32') {
    const local =
      env.LOCALAPPDATA ??
      (env.USERPROFILE ? join(env.USERPROFILE, 'AppData', 'Local') : undefined)
    return local ? join(local, 'sessclone') : undefined
  }

  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'sessclone')
  }

  return env.XDG_STATE_HOME
    ? join(env.XDG_STATE_HOME, 'sessclone')
    : join(homedir(), '.local', 'state', 'sessclone')
}

/**
 * A base URL with no trailing slash, or a sentence saying why it is not one.
 *
 * The trailing slash is trimmed rather than refused: `https://example.com/`
 * is what a person copies out of a browser's address bar, and refusing it
 * would be pedantry that costs a support message. `//api/ingest` against an
 * untrimmed base is a request that goes somewhere else entirely, so trimming
 * it here is what keeps every call site from having to remember.
 *
 * @param {string | undefined} raw
 * @returns {{ url: string } | { problem: string }}
 */
const readUrl = (raw) => {
  if (raw === undefined || raw.trim() === '') return { url: DEFAULT_URL }

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return {
      problem: `SESSCLONE_URL is not a URL: ${raw}. It should look like ${DEFAULT_URL}.`,
    }
  }

  // A `postgres://` or a bare `example.com` parses or fails in ways that are
  // both unhelpful later: the first becomes a fetch that throws about an
  // unsupported protocol, the second is read as a URL whose protocol is the
  // hostname.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      problem: `SESSCLONE_URL must be http or https, not ${parsed.protocol.replace(':', '')}: ${raw}.`,
    }
  }

  return { url: raw.trim().replace(/\/+$/, '') }
}

/**
 * @typedef {object} CollectorConfiguration
 * @property {string} apiKey The Member's key. Never logged, never reported.
 * @property {string} url Base URL of the deployment, no trailing slash.
 * @property {string} stateDir Where the cursor and the retry queue live.
 * @property {string | undefined} device `SESSCLONE_DEVICE`, used verbatim when set.
 */

/**
 * Reads the Collector's configuration, or throws a {@link ConfigurationError}
 * naming every problem at once.
 *
 * Every problem, not the first: a machine configured from a copied snippet
 * usually has both variables wrong, and reporting them one session at a time
 * is two restarts instead of one.
 *
 * The environment is a parameter rather than read from `process.env` inside,
 * which is what makes every branch here testable without mutating the
 * process — and what lets a hook pass the environment Claude Code handed it.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {NodeJS.Platform} [platform]
 * @returns {CollectorConfiguration}
 */
export const readConfiguration = (
  env = process.env,
  platform = process.platform,
) => {
  /** @type {string[]} */
  const problems = []

  const apiKey = env.SESSCLONE_API_KEY?.trim()
  if (!apiKey) {
    problems.push(
      'SESSCLONE_API_KEY is not set. Create a key in the dashboard under Keys and set it in the environment Claude Code runs in.',
    )
  } else if (!KEY_PATTERN.test(apiKey)) {
    // The length and the prefix, and never the key itself: those two are
    // enough to tell a truncated paste from a wrapped one, and neither is
    // secret.
    problems.push(
      `SESSCLONE_API_KEY is not a sessclone key: it starts "${apiKey.slice(0, 3)}" and is ${apiKey.length} characters, where a key starts "sk_" and is 46. Copy it again from the dashboard.`,
    )
  }

  const url = readUrl(env.SESSCLONE_URL)
  if ('problem' in url) problems.push(url.problem)

  const node = nodeProblem(process.versions.node)
  if (node) problems.push(node)

  const stateDir =
    env.SESSCLONE_STATE_DIR?.trim() || defaultStateDir(platform, env)
  if (!stateDir) {
    problems.push(
      'SESSCLONE_STATE_DIR is not set and no default could be resolved on this platform. Set it to a directory the Collector may write to.',
    )
  }

  // Each disjunct below is already a problem above, and restating them here
  // is what narrows the three values from "or undefined" without a cast.
  if (problems.length > 0 || !apiKey || 'problem' in url || !stateDir) {
    throw new ConfigurationError(problems)
  }

  return {
    apiKey,
    url: url.url,
    stateDir,
    // Used verbatim where it is set, which is also how it pins an identity
    // across a rename (`deviceKey` in `packages/shared`).
    device: env.SESSCLONE_DEVICE?.trim() || undefined,
  }
}
