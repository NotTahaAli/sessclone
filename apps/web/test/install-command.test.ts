import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'
import { z } from 'zod'

import { HOSTED_URL, installCommand } from '../lib/install-command'

// Taha asked for a one-command install on the dashboard (2026-09-22):
// `claude plugin install sessclone --config url=… --config api_key=…`. The
// flag is real — `claude plugin install --help` declares `--config <key=value>`
// and says the value is validated against the plugin manifest's schema — which
// is exactly what makes this worth a test: a key the manifest does not declare
// is refused at install time, on somebody's machine, far from here.

// Parsed rather than asserted, so a manifest that changes shape fails here
// with the reason rather than reading as an empty set of settings.
const manifest = z
  .object({
    name: z.string(),
    userConfig: z.record(
      z.string(),
      z.object({
        required: z.boolean().optional(),
        default: z.string().optional(),
      }),
    ),
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL(
          '../../../packages/plugin/.claude-plugin/plugin.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  )

test('a self-hosted command names its URL and the key', () => {
  const command = installCommand('https://sessclone.example.com', 'sk_live_123')

  expect(command).toBe(
    `claude plugin install ${manifest.name}` +
      ' --config url=https://sessclone.example.com' +
      ' --config api_key=sk_live_123',
  )

  // Only keys the manifest declares: an undeclared one is refused at install.
  for (const [, key] of command.matchAll(/--config (\w+)=/g))
    expect(Object.keys(manifest.userConfig)).toContain(key)
})

test('the hosted service needs no URL, and a cloud environment no key', () => {
  // The URL the command leaves out is the one the manifest defaults to.
  expect(manifest.userConfig.url?.default).toBe(HOSTED_URL)
  expect(installCommand(HOSTED_URL, 'sk_live_123')).toBe(
    `claude plugin install ${manifest.name} --config api_key=sk_live_123`,
  )
  expect(installCommand(HOSTED_URL)).toBe(
    `claude plugin install ${manifest.name}`,
  )
})

test('a cloud environment installs with no key at all', async () => {
  // Ticket 95. The proxy adds the environment's credential to a request that
  // carries none, so the Collector must accept a configuration without one
  // rather than refuse it at session start and collect nothing.
  // By URL rather than by specifier: the plugin is JSDoc-typed JavaScript
  // this project's `tsc` does not read, and the check is the real one.
  const { readConfiguration } = await import(
    new URL('../../../packages/plugin/src/configuration.mjs', import.meta.url)
      .href
  )
  expect(
    readConfiguration(
      {
        SESSCLONE_URL: 'https://sessclone.example.com',
        SESSCLONE_STATE_DIR: '/tmp/sessclone-test',
      },
      'linux',
    ).apiKey,
  ).toBeUndefined()
})
