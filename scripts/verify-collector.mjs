#!/usr/bin/env node
// Tickets 68, 69 and 70: one command per machine, and a block to paste back.
//
// The three tickets it serves cannot be automated — they are about real
// machines running real Claude Code. What this removes is the transcription:
// rather than asking a person to find their state directory, read a version
// out of a directory name and count Turns by eye, it reads them and prints
// them, in the same order the ticket's checkboxes ask for them.
//
//   node scripts/verify-collector.mjs
//   node scripts/verify-collector.mjs --reconcile --day 2026-09-22 --tz Asia/Karachi
//
// `--no-probe` skips the one network call, an empty POST to the deployment's
// `/api/ingest`. A shell never holds the key (Claude Code gives it to hooks
// only), so the key's verdict is what the last session start recorded.
//
// Run it from a clone. An install carries `packages/plugin` alone, with no
// `scripts/` directory and no `node_modules` beside it (PR #12), so there is no
// copy of this file on an installed machine to run instead.

import { nodeProblem } from '../packages/plugin/src/configuration.mjs'
import { throughProxy } from '../packages/plugin/src/proxy.mjs'

// `verify.mjs` imports `packages/shared` as TypeScript, which an old Node
// cannot load: imported at the top, this printed a stack trace on exactly the
// Node it should be naming. So the Node first, then the import.
const node = nodeProblem(process.versions.node)
if (node) {
  process.stderr.write(`${node}\n`)
  process.exit(1)
}
const { format, formatCount, collect, handCount } =
  await import('../packages/plugin/src/verify.mjs')

// Ticket 98: the probe takes the route the hooks take, proxy included.
throughProxy()

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name) => {
  const at = argv.indexOf(`--${name}`)
  return at === -1 ? undefined : argv[at + 1]
}

if (flag('help')) {
  process.stdout.write(
    [
      'Usage: node scripts/verify-collector.mjs [options]',
      '',
      "  --reconcile      Count a day of Turns from this machine's transcripts (ticket 70)",
      '  --day <date>     YYYY-MM-DD for --reconcile. Omitted, every day is counted.',
      "  --tz <zone>      The Org's timezone for --reconcile. Default: this machine's.",
      '  --no-probe       Do not contact SESSCLONE_URL.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

if (flag('reconcile')) {
  const day = value('day') ?? null
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    process.stderr.write(`--day must be YYYY-MM-DD, not ${day}\n`)
    process.exit(2)
  }
  const timeZone =
    value('tz') ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  process.stdout.write(`${formatCount(await handCount({ day, timeZone }))}\n`)
} else {
  process.stdout.write(
    `${format(await collect({ probe: !flag('no-probe') }))}\n`,
  )
}
