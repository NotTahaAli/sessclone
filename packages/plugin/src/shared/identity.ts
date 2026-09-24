// Device and Project keys. Both exist because the obvious key is wrong: a
// Claude Code Cloud container is a new machine every hour, and one repository
// is spelled several ways by the machines that cloned it. A key that followed
// either would split a Member's dashboard into rows that mean nothing.

/** Anything with a scheme: `https://host/path`, `ssh://git@host:22/path`. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i

const URL_REMOTE = /^[a-z][a-z0-9+.-]*:\/\/(?<authority>[^/]+)\/(?<path>.+)$/i

// The scp form: `git@github.com:owner/repo.git`. The authority must carry a
// dot, which is what keeps a Windows path (`C:\code\repo`), a bare word
// (`TODO:fix`) and a scheme this cannot read (`file://…`, whose authority is
// empty) from being read as hosts — each of those is a remote no dashboard can
// group by, so it falls through to the local key instead. The path rejects a
// second colon, which would be a port in the wrong place.
//
// Read by hand rather than with the one regular expression this used to be,
// `^(?:[^@\s/]+@)?(?<authority>[^\s/:]*\.[^\s/:]+):(?<path>[^\s\\:][^\s:]*)$`,
// whose authority backtracks quadratically on a run of dots — and ingest runs
// this on request data. Each step below is that expression's, in linear time.
const scpRemote = (remote: string) => {
  // The path holds no colon, so the separator is the last one.
  const colon = remote.lastIndexOf(':')
  if (colon === -1 || /\s/.test(remote)) return undefined
  const before = remote.slice(0, colon)
  const path = remote.slice(colon + 1)
  if (before.includes('/') || path === '' || path.startsWith('\\'))
    return undefined

  // With a user, the authority follows the first `@`; failing that, the
  // expression retries with no user at all.
  const at = before.indexOf('@')
  const authority = (at > 0 ? [before.slice(at + 1), before] : [before]).find(
    (candidate) => {
      const dot = candidate.indexOf('.')
      return (
        !candidate.includes(':') && dot !== -1 && dot < candidate.length - 1
      )
    },
  )
  return authority === undefined ? undefined : { authority, path }
}

// `/\/+$/` is quadratic on a run of slashes that does not reach the end.
const withoutTrailingSlashes = (value: string) => {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

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
  const trimmed = withoutTrailingSlashes(remote.trim())
  if (trimmed === '') return null

  // A string that names a scheme gets exactly one reading. Letting it fall
  // through to the scp form would read `file:///srv/git/repo` as the host
  // `file`, and every machine with a bare repo at that path would collapse
  // into one Project.
  const matched = SCHEME.test(trimmed)
    ? URL_REMOTE.exec(trimmed)?.groups
    : scpRemote(trimmed)
  if (matched === undefined) return null

  const host = withoutPort(withoutCredentials(matched.authority ?? ''))
  const path = withoutTrailingSlashes(
    (matched.path ?? '').replace(/^\/+/, '').replace(/\.git$/i, ''),
  )

  if (host === '' || path === '') return null

  return `${host}/${path}`.toLowerCase()
}

/**
 * The remote as git reported it, minus any credential embedded in it. A token
 * pasted into a remote URL is a live secret, and this string is shipped to
 * ingest and shown on a dashboard to explain a key — so the credential comes
 * out here rather than landing in a row nobody thinks of as sensitive.
 */
export const withoutEmbeddedCredentials = (remote: string): string =>
  remote.replace(
    /^(?<scheme>[a-z][a-z0-9+.-]*:\/\/)(?<userinfo>[^/@]*@)/i,
    '$<scheme>',
  )

const machine = (hostname: string) => {
  const named = hostname.trim().toLowerCase()
  return named === '' ? 'unknown' : named
}

// `C:\code\repo`, `c:/code/repo`. One real Windows box spelled its own working
// directory both ways — 1,125 entries lowercase against 281 uppercase, same
// session, same client version — and the filesystem does not distinguish them.
const WINDOWS_PATH = /^[a-z]:[\\/]/i

export type ProjectIdentity = {
  key: string
  /** The remote git reported, credentials removed, so a key can be explained. */
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
}: {
  remote: string | null | undefined
  cwd: string
  hostname: string
}): ProjectIdentity => {
  const reported =
    remote === null || remote === undefined || remote.trim() === ''
      ? null
      : withoutEmbeddedCredentials(remote)
  const normalised = reported === null ? null : normaliseRemote(reported)

  if (normalised !== null) return { key: normalised, remote: reported }

  // The fold is decided by the path, not by the platform this code runs on:
  // ingest and the dashboard compute keys from a stored `cwd` on a Linux
  // server, and would otherwise reintroduce the split the fold exists to
  // close.
  const path = WINDOWS_PATH.test(cwd) ? cwd.toLowerCase() : cwd

  return { key: `local:${machine(hostname)}:${path}`, remote: reported }
}

// Claude Code Cloud names the account and the environment type in the
// environment of every session it runs; the container id sits beside them and
// is deliberately unused, because it is the thing that changes hourly.
// An explicit override, for the case neither rule below can see: one account
// running several environments that should be counted separately. Taken
// verbatim, because the point of it is to pin an identity the Collector would
// otherwise compute differently.
const OVERRIDE = 'SESSCLONE_DEVICE'
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
 * machine called `build-box`, so the Device row is scoped to its Member by the
 * schema rather than by anything in this string.
 *
 * Resolution order: `SESSCLONE_DEVICE` when set, then the cloud account, then
 * the machine. The Collector calls this rather than keeping its own copy —
 * spec §Packages puts logic beyond orchestration in `shared`, and a key
 * spelled two ways is two Devices.
 */
export const deviceKey = ({
  hostname,
  environment,
}: {
  hostname: string
  environment: Record<string, string | undefined>
}): string => {
  const override = environment[OVERRIDE]?.trim()
  if (override !== undefined && override !== '') return override

  const account = environment[ACCOUNT]?.trim()

  if (
    environment[CLOUD]?.trim() === 'true' &&
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
