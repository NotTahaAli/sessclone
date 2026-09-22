import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

import { SWEEP_BUDGET_MS } from './report.mjs'

// Ticket 66. An install is two commands, and everything that happens after
// them is manifest: the marketplace entry points at the plugin, the plugin
// points at its hooks file, the hooks file points at four scripts, and each of
// those reaches outside the plugin directory for the parser and the identity
// rules in `packages/shared`.
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

test('every hook the plugin registers runs a script that is there', async () => {
  // Walked, not written out: repointing `plugin.json`'s `hooks` at some other
  // existing file would otherwise leave this green with no hook registered.
  const root = join(repository, 'packages/plugin')
  const plugin = await json(join(root, '.claude-plugin/plugin.json'))

  expect(plugin.name).toBe('sessclone')
  expect(typeof plugin.hooks).toBe('string')
  expect(plugin.hooks.startsWith('./')).toBe(true)

  const { hooks } = await json(join(root, plugin.hooks))
  expect(Object.keys(hooks).toSorted()).toEqual(EVENTS.toSorted())

  for (const event of EVENTS) {
    const entries = hooks[event].flatMap((group) => group.hooks)
    expect(entries).toHaveLength(1)

    const [entry] = entries
    expect(entry.type).toBe('command')

    // `${CLAUDE_PLUGIN_ROOT}` is the plugin's installed directory, which is
    // the only path form that survives the copy an install makes.
    const referenced = [entry.command, ...(entry.args ?? [])].filter((part) =>
      part.includes('${CLAUDE_PLUGIN_ROOT}'),
    )
    expect(referenced).toHaveLength(1)

    const script = referenced[0].replaceAll('${CLAUDE_PLUGIN_ROOT}', root)
    // eslint-disable-next-line no-await-in-loop -- four files, in order, for a readable failure
    expect(await exists(script)).toBe(true)

    // The hook's own deadline has to leave room for the sweep it starts,
    // which is the invariant rather than any particular number of seconds.
    expect(entry.timeout * 1000).toBeGreaterThan(SWEEP_BUDGET_MS)
  }
})

test('what the hooks import from outside the plugin is still there', async () => {
  // The hooks reach into `packages/shared` by relative path, which is why an
  // install that copies only the plugin directory reports nothing (docs/install.md).
  // Renaming a module over there breaks no build in this package.
  const files = [
    'hooks/session-start.mjs',
    'hooks/session-end.mjs',
    'hooks/stop.mjs',
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
