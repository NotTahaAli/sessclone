import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

import { SWEEP_BUDGET_MS } from './report.mjs'

// Ticket 66. An install is two commands, and everything that happens after
// them is manifest: the marketplace entry points at the plugin, Claude Code
// loads the plugin's hooks file by its path, and that file points at four
// scripts which import the parser and the identity rules beside them.
//
// Every one of those pointers can be broken by a rename that breaks no build
// and fails no other test — the Collector simply stops collecting, silently,
// which is the one failure this product cannot notice on its own. So the whole
// chain is walked here, in one test, rather than each link being checked
// against a path written out again beside it.
//
// The schema is Claude Code's own: https://code.claude.com/docs/en/plugins-reference,
// /plugin-marketplaces and /hooks (read 2026-09-22).

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const json = async (path) => JSON.parse(await readFile(path, 'utf8'))

const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  )

/** Where Claude Code looks for a plugin's hooks, with no manifest entry. */
const HOOKS_FILE = 'hooks/hooks.json'

/** The per-turn cloud archive, the one async `Stop` entry (ticket 99). */
const isArchive = (entry) =>
  entry.args?.some((part) => part.endsWith('/hooks/stop-archive.mjs'))

/** The events the Collector registers. */
const EVENTS = ['SessionStart', 'Stop', 'StopFailure', 'SessionEnd']

test('the marketplace entry points at this repository’s plugin', async () => {
  // `.claude-plugin/marketplace.json` at the repository root is where
  // `/plugin marketplace add <owner>/<repo>` looks, and nowhere else.
  const marketplace = await json(
    join(repository, '.claude-plugin/marketplace.json'),
  )

  expect(marketplace.name).toBe('sessclone')
  expect(marketplace.owner.name).toBeTruthy()

  const entry = marketplace.plugins.find(
    (plugin) => plugin.name === 'sessclone',
  )
  expect(entry).toBeDefined()
  // A relative source resolves against the marketplace root, which is what
  // makes a self-hoster's fork install by the same two commands.
  expect(entry.source.startsWith('./')).toBe(true)
  expect(
    await exists(join(repository, entry.source, '.claude-plugin/plugin.json')),
  ).toBe(true)
})

test('the manifest does not name the hooks file Claude Code loads itself', async () => {
  // `hooks/hooks.json` is loaded by its path alone, and naming it under
  // `hooks` in the manifest loads it twice — which Claude Code refuses:
  // "Duplicate hooks file detected ... manifest.hooks should only reference
  // additional hook files." The plugin then registers no hooks at all and
  // collects nothing, which is the same silence this package keeps being
  // caught by. So `hooks` stays absent while the standard file is the only
  // one there.
  const plugin = await json(
    join(repository, 'packages/plugin/.claude-plugin/plugin.json'),
  )

  expect(plugin.hooks).toBeUndefined()
  expect(await exists(join(repository, 'packages/plugin', HOOKS_FILE))).toBe(
    true,
  )
})

test('every hook the plugin registers runs a script that is there', async () => {
  const root = join(repository, 'packages/plugin')
  const { hooks } = await json(join(root, HOOKS_FILE))
  expect(Object.keys(hooks).toSorted()).toEqual(EVENTS.toSorted())

  for (const event of EVENTS) {
    const entries = hooks[event].flatMap((group) => group.hooks)
    // Stop carries the per-turn cloud archive beside the flush (ticket 99).
    expect(entries).toHaveLength(event === 'Stop' ? 2 : 1)

    for (const entry of entries) {
      expect(entry.type).toBe('command')

      // `${CLAUDE_PLUGIN_ROOT}` is the plugin's installed directory, which is
      // the only path form that survives the copy an install makes.
      const referenced = [entry.command, ...(entry.args ?? [])].filter((part) =>
        part.includes('${CLAUDE_PLUGIN_ROOT}'),
      )
      expect(referenced).toHaveLength(1)

      const script = referenced[0].replaceAll('${CLAUDE_PLUGIN_ROOT}', root)
      // eslint-disable-next-line no-await-in-loop -- five files, in order, for a readable failure
      expect(await exists(script)).toBe(true)

      // The hook's own deadline has to leave room for the sweep it starts,
      // which is the invariant rather than any particular number of seconds.
      // The async archive starts no sweep, and nothing enforces its timeout.
      if (!isArchive(entry)) {
        expect(entry.timeout * 1000).toBeGreaterThan(SWEEP_BUDGET_MS)
      }
    }
  }
})

test('the SessionEnd hook runs asynchronously, so the exit cannot cancel it', async () => {
  // Claude Code's own limit, and the one this plugin kept hitting: "all
  // SessionEnd hooks together share a 1.5-second budget", against a hook that
  // flushes the last Turns and then archives transcripts. The `timeout: 10`
  // above is documented to raise that shared budget, and did not on a real
  // machine — the Member read `SessionEnd hook [...] failed: Hook cancelled`
  // at every exit (2026-09-22).
  //
  // `async: true` is the documented way out: Claude Code spawns the hook and
  // continues, and a hook still running at exit is orphaned rather than
  // killed. It costs nothing here because SessionEnd has no decision fields —
  // its output was already ignored — and the hook is silent by design.
  const root = join(repository, 'packages/plugin')
  const { hooks } = await json(join(root, HOOKS_FILE))
  const [sessionEnd] = hooks.SessionEnd.flatMap((group) => group.hooks)
  expect(sessionEnd.async).toBe(true)

  // And only SessionEnd and the per-turn cloud archive (ticket 99), which
  // nothing waits on: a Stop flush that returned no decision would let the
  // turn end before its Turns were read, and the sweep's one-line notice on
  // SessionStart is stderr Claude Code would stop reading.
  for (const event of EVENTS.filter((name) => name !== 'SessionEnd')) {
    const entries = hooks[event].flatMap((group) => group.hooks)
    for (const entry of entries) {
      expect(entry.async).toBe(isArchive(entry) ? true : undefined)
    }
  }
  expect(hooks.Stop.flatMap((group) => group.hooks).some(isArchive)).toBe(true)
})

test('what the hooks import is still there', async () => {
  // Every specifier is resolved on disk. `src/installable.test.mjs` is what
  // keeps them inside the plugin, which an install is; this is what keeps
  // them pointing at a file that exists, which a rename can break with no
  // other test going red.
  const files = [
    'hooks/session-start.mjs',
    'hooks/session-end.mjs',
    'hooks/stop.mjs',
    'hooks/stop-archive.mjs',
    'hooks/stop-failure.mjs',
    'src/report.mjs',
    'src/configuration.mjs',
    'src/queue.mjs',
    'src/transcripts.mjs',
  ]

  const outside = []
  for (const file of files) {
    const path = join(repository, 'packages/plugin', file)
    // eslint-disable-next-line no-await-in-loop -- a handful of small files
    const source = await readFile(path, 'utf8')
    // Static and lazy alike: the hooks import `shared` inside a `try` on
    // purpose (an old Node has to fail quietly), so the dynamic form is the
    // one that matters most here.
    for (const [, statik, lazy] of source.matchAll(
      /from\s+'(\.\.\/[^']+)'|import\('(\.\.\/[^']+)'\)/g,
    )) {
      const specifier = statik ?? lazy
      if (specifier) outside.push({ file, specifier })
    }
  }

  // If this is empty the regex stopped matching, not the imports stopped
  // existing — an assertion that passes because it found nothing is worse
  // than no assertion.
  expect(outside.length).toBeGreaterThan(0)

  for (const { file, specifier } of outside) {
    const target = resolve(
      dirname(join(repository, 'packages/plugin', file)),
      specifier,
    )
    // eslint-disable-next-line no-await-in-loop -- as above
    expect(await exists(target), `${file} imports ${specifier}`).toBe(true)
  }
})
