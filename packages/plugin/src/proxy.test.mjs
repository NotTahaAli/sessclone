import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

import { needsProxyRestart } from './proxy.mjs'

// Ticket 98: Node's `fetch` connects directly unless `NODE_USE_ENV_PROXY` is
// set at startup, so a cloud environment's credential never reached ingest.

const FLAGS = new Set(['--use-env-proxy'])
const PROXY = { HTTPS_PROXY: 'http://proxy.test:8080' }

test('a proxy and a Node that can use it restart the hook', () => {
  expect(needsProxyRestart(PROXY, FLAGS, [])).toBe(true)
  expect(needsProxyRestart({ https_proxy: 'http://p:1' }, FLAGS, [])).toBe(true)
})

test('no restart without a proxy, once on, or on a Node that cannot', () => {
  expect(needsProxyRestart({}, FLAGS, [])).toBe(false)
  expect(
    needsProxyRestart({ ...PROXY, NODE_USE_ENV_PROXY: '1' }, FLAGS, []),
  ).toBe(false)
  expect(needsProxyRestart(PROXY, FLAGS, ['--use-env-proxy'])).toBe(false)
  // Below the Node that has the flag the variable is ignored too, and a
  // restart would only be a second start that changes nothing.
  expect(needsProxyRestart(PROXY, new Set(), [])).toBe(false)
})

test.runIf(process.allowedNodeEnvironmentFlags.has('--use-env-proxy'))(
  'the restarted hook gets the proxy switch and the event unread',
  () => {
    const hook = join(mkdtempSync(join(tmpdir(), 'sessclone-proxy-')), 'h.mjs')
    const proxy = fileURLToPath(new URL('./proxy.mjs', import.meta.url))
    writeFileSync(
      hook,
      `import { throughProxy } from ${JSON.stringify(proxy)}
throughProxy()
// A closed local port: enough to make the proxy agent start, and warn.
await fetch('http://127.0.0.1:1').catch(() => {})
let input = ''
for await (const chunk of process.stdin) input += chunk
process.stdout.write(JSON.stringify({ env: process.env.NODE_USE_ENV_PROXY, input }))
process.exit(3)
`,
    )
    const run = spawnSync(process.execPath, [hook], {
      input: '{"session_id":"s-1"}',
      env: { ...process.env, ...PROXY, NODE_USE_ENV_PROXY: '' },
      encoding: 'utf8',
    })
    expect(JSON.parse(run.stdout)).toEqual({
      env: '1',
      input: '{"session_id":"s-1"}',
    })
    // The child's exit status is the hook's, so session-start's exit 2 still
    // shows its message.
    expect(run.status).toBe(3)
    expect(run.stderr).not.toContain('EnvHttpProxyAgent')
  },
)
