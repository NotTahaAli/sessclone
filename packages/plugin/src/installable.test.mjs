import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The test that would have caught the install being broken from the first
// machine it was ever installed on.
//
// A Claude Code plugin is installed by copying its own directory — and only
// that — into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. So
// a hook that imports a path leaving `packages/plugin` resolves to nothing
// there, however well it resolves in this repository. That is what
// `../../shared/src/turns.ts` did, and `session-start.mjs` catches the sweep's
// failure and says nothing by design, so the result was an install that
// started cleanly, reported nothing, and gave no reason.
//
// Everything a hook can reach at runtime is checked, which is the hooks and
// the modules under `src/` that are not tests. A test may reach out of the
// package: it runs here, never there.

const root = fileURLToPath(new URL('..', import.meta.url))

/** Every runtime module of the plugin, as paths relative to its root. */
const runtimeModules = async () => {
  const perDirectory = await Promise.all(
    ['hooks', 'src'].map((directory) =>
      readdir(join(root, directory), { recursive: true, withFileTypes: true }),
    ),
  )

  return perDirectory.flat().flatMap((entry) => {
    if (!entry.isFile()) return []
    if (!/\.(mjs|ts)$/.test(entry.name)) return []
    if (entry.name.includes('.test.')) return []
    return [join(entry.parentPath, entry.name).slice(root.length)]
  })
}

/**
 * The source with its comments removed.
 *
 * Both files below are heavily commented, and the comments name modules — a
 * JSDoc `import('@sessclone/shared').Turn` is a type annotation Node never
 * loads, and a sentence about importing something is not an import at all.
 * Block comments go, and so does a line that begins with `//`; a `//` inside a
 * string is left alone, so nothing after it on that line is lost.
 */
const withoutComments = (source) =>
  source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')

/** Every specifier an `import` in this source names, static or dynamic. */
const specifiers = (source) =>
  [
    ...withoutComments(source).matchAll(
      /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g,
    ),
  ].map((match) => match[1])

describe('an installed plugin carries everything its hooks import', () => {
  it('imports nothing above its own directory', async () => {
    const modules = await runtimeModules()
    // A guard on the guard: a glob that silently matched nothing would make
    // every assertion below vacuous.
    expect(modules.length).toBeGreaterThan(5)

    const escaping = []
    await Promise.all(
      modules.map(async (module) => {
        const source = await readFile(join(root, module), 'utf8')
        for (const specifier of specifiers(source)) {
          if (!specifier.startsWith('.')) continue
          // One `..` is `hooks/` reaching `src/`, which the copy carries. Two
          // leaves the package, whatever it then points at.
          if (specifier.startsWith('../../')) {
            escaping.push(`${module} imports ${specifier}`)
          }
        }
      }),
    )

    expect(escaping).toEqual([])
  })

  it('imports nothing that is not a bare node: builtin or a file beside it', async () => {
    // The second half of the same fact: an installed plugin has no
    // `node_modules`, so a dependency is as absent as a file outside the
    // directory. `node:` builtins are all that is there.
    const modules = await runtimeModules()
    const bare = []
    await Promise.all(
      modules.map(async (module) => {
        const source = await readFile(join(root, module), 'utf8')
        for (const specifier of specifiers(source)) {
          if (specifier.startsWith('.')) continue
          if (specifier.startsWith('node:')) continue
          bare.push(`${module} imports ${specifier}`)
        }
      }),
    )

    expect(bare).toEqual([])
  })
})
