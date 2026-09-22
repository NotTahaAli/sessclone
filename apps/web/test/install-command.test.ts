import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'
import { z } from 'zod'

import { installCommand } from '../lib/install-command'

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
      z.object({ required: z.boolean().optional() }),
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

test('the command names the plugin and both of its required settings', () => {
  const command = installCommand('https://sessclone.example.com', 'sk_live_123')

  expect(command).toBe(
    `claude plugin install ${manifest.name}` +
      ' --config url=https://sessclone.example.com' +
      ' --config api_key=sk_live_123',
  )

  // Every setting the manifest requires is on the command line, so an install
  // run this way never stops to ask.
  for (const [key, setting] of Object.entries(manifest.userConfig))
    if (setting.required) expect(command).toContain(` --config ${key}=`)
})
