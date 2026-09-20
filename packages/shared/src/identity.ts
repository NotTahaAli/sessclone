// Device and Project keys. Both exist because the obvious key is wrong: a
// Claude Code Cloud container is a new machine every hour, and one repository
// is spelled several ways by the machines that cloned it. A key that follows
// either would split a Member's dashboard into rows that mean nothing.

/** The scheme form: `https://host/path`, `ssh://git@host:22/path`, `git://…`. */
const URL_REMOTE = /^[a-z][a-z0-9+.-]*:\/\/(?<authority>[^/]+)\/(?<path>.+)$/i

// The scp form: `git@github.com:owner/repo.git`. The host is two characters or
// more and the path may not open with a backslash, which is what keeps a
// Windows path (`C:\code\repo`) out — it is a perfectly good git remote, but it
// is not a `host/owner/repo` and must fall through to the local key instead.
const SCP_REMOTE =
  /^(?:[^@\s/]+@)?(?<authority>[^\s/:]{2,}):(?<path>[^\s\\][^\s]*)$/

const withoutCredentials = (authority: string) =>
  authority.slice(authority.lastIndexOf('@') + 1)

const withoutPort = (host: string) => host.replace(/:\d+$/, '')

/**
 * Reduces a git remote to `host/owner/repo`, lowercased, with credentials and
 * the `.git` suffix stripped — so the same repository is one Project however
 * each machine cloned it. Null when the string is not a remote this can read,
 * which is a signal to fall back rather than an error.
 */
export const normaliseRemote = (remote: string): string | null => {
  const trimmed = remote.trim().replace(/\/+$/, '')
  if (trimmed === '') return null

  const groups = (URL_REMOTE.exec(trimmed) ?? SCP_REMOTE.exec(trimmed))?.groups
  if (groups === undefined) return null

  const host = withoutPort(withoutCredentials(groups.authority ?? ''))
  const path = (groups.path ?? '')
    .replace(/^\/+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')

  if (host === '' || path === '') return null

  return `${host}/${path}`.toLowerCase()
}

const machine = (hostname: string) =>
  hostname.trim().toLowerCase() === ''
    ? 'unknown'
    : hostname.trim().toLowerCase()

export type ProjectIdentity = {
  key: string
  /** The remote exactly as git reported it, kept so a key can be explained. */
  remote: string | null
}

/**
 * The Project a Session ran against. A repository keys by its remote; anything
 * else keys by machine and absolute path, because a bare directory name would
 * merge every `notes` folder in an Org into one Project.
 */
export const projectKey = ({
  remote,
  cwd,
  hostname,
  platform,
}: {
  remote: string | null | undefined
  cwd: string
  hostname: string
  platform?: string
}): ProjectIdentity => {
  const normalised =
    remote === null || remote === undefined ? null : normaliseRemote(remote)

  if (normalised !== null) return { key: normalised, remote: remote ?? null }

  // Windows spells one directory two ways: a real box reported
  // `c:\Users\…` on 1,125 entries and `C:\Users\…` on 281, same session, same
  // client version. The filesystem does not distinguish them and neither may
  // the key — while a case-sensitive filesystem elsewhere genuinely can hold
  // both `notes` and `Notes`.
  const path = platform === 'win32' ? cwd.toLowerCase() : cwd

  return { key: `local:${machine(hostname)}:${path}`, remote: remote ?? null }
}

// Claude Code Cloud names the account and the environment type in the
// environment of every session it runs; the container id sits beside them and
// is deliberately unused, because it is the thing that changes hourly.
const CLOUD = 'CLAUDE_CODE_REMOTE'
const ACCOUNT = 'CLAUDE_CODE_ACCOUNT_UUID'
const ENVIRONMENT_TYPE = 'CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE'
const DEFAULT_ENVIRONMENT = 'cloud_default'

/**
 * The Device a Session ran on. Local machines key by hostname; a cloud session
 * keys by account, so every container a Member burns through collapses into
 * one Device rather than filling a dashboard with hours-old machines.
 *
 * The key is unique inside a Member, never globally: two Members may own a
 * machine called `build-box`, so the Device row is scoped to its Member.
 */
export const deviceKey = ({
  hostname,
  environment,
}: {
  hostname: string
  environment: Record<string, string | undefined>
}): string => {
  const account = environment[ACCOUNT]?.trim()

  if (
    environment[CLOUD] === 'true' &&
    account !== undefined &&
    account !== ''
  ) {
    const type = environment[ENVIRONMENT_TYPE]?.trim()
    const suffix =
      type === undefined || type === '' || type === DEFAULT_ENVIRONMENT
        ? ''
        : `:${type}`

    return `cloud:${account}${suffix}`
  }

  return `host:${machine(hostname)}`
}
