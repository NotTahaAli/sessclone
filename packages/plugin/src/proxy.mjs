// Ticket 97: the Collector goes through `HTTPS_PROXY` when one is set.
//
// Node's `fetch` ignores the proxy variables unless it was started with
// `NODE_USE_ENV_PROXY=1` (or `--use-env-proxy`). A Claude Code cloud
// environment routes egress through Anthropic's agent proxy, which is also
// what adds the environment's API credential to a request — so a direct
// connection reaches ingest with the setup script's placeholder key and is
// answered 401, and nothing is collected (found 2026-09-22 in a Claude
// Projects container: 401 direct, 200 through the proxy).
//
// No API turns proxying on in a running process: the variable is read at
// startup. So a hook that finds a proxy and a Node that can use it starts
// itself again with the variable set, and exits with the child's status.
// stdin is inherited unread, so the child gets the hook's event untouched.
//
// ponytail: one extra Node start per hook where a proxy is set, tens of
// milliseconds. The upgrade is `http.setGlobalProxyFromEnv()` once the
// Node floor has it.

import { spawnSync } from 'node:child_process'

/**
 * Whether this process should start again with the proxy turned on.
 *
 * The flag is the feature test rather than a version comparison: a Node that
 * accepts `--use-env-proxy` reads `NODE_USE_ENV_PROXY` too, and one that does
 * not would ignore the variable and loop through a pointless second start.
 *
 * From Node's own `doc/api/cli.md`: both arrived in v22.21.0 on the 22 line;
 * on 24 the variable in v24.0.0 and the flag in v24.5.0, so 24.0 to 24.4
 * connect directly here, which is the conservative miss.
 *
 * @param {Record<string, string | undefined>} env
 * @param {ReadonlySet<string>} flags `process.allowedNodeEnvironmentFlags`
 * @param {readonly string[]} execArgv
 */
export const needsProxyRestart = (env, flags, execArgv) =>
  Boolean(env.HTTPS_PROXY || env.https_proxy) &&
  !env.NODE_USE_ENV_PROXY &&
  !execArgv.includes('--use-env-proxy') &&
  flags.has('--use-env-proxy')

/** Starts this hook again through the proxy when it needs to; else returns. */
export const throughProxy = () => {
  if (
    !needsProxyRestart(
      process.env,
      process.allowedNodeEnvironmentFlags,
      process.execArgv,
    )
  )
    return
  const child = spawnSync(
    process.execPath,
    // The proxy agent warns that it is experimental on every start, and a
    // hook's stderr lands in the transcript this product uploads.
    [
      '--disable-warning=UNDICI-EHPA',
      ...process.execArgv,
      ...process.argv.slice(1),
    ],
    { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } },
  )
  // The restart could not start at all: run here, directly, as before.
  if (child.error) return
  // A signal leaves no status. Every hook exits 0 on its own failures anyway,
  // and a parent killed by the hook's timeout leaves this child to finish on
  // its own, bounded by the child's own deadline.
  process.exit(child.status ?? 0)
}
