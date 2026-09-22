import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'vitest'

// Ticket 15's contract, made executable. `docs/configuration.md` is the prose
// a self-hoster reads and `.env.example` is what they copy; a variable named
// in one and forgotten in the other, or a default written differently in each,
// is the failure this catches. Nothing else would — a missing variable
// surfaces at runtime, on their deployment, as whatever the client library
// does when handed `undefined`.
const root = new URL('../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

const documentation = read('docs/configuration.md')
const example = read('.env.example')

// A table row whose first cell is one backticked identifier. Every documented
// variable is declared that way and nothing else in the file is, which is what
// keeps prose mentions of Claude Code's own `CLAUDE_CONFIG_DIR` — and the
// platform table below it, keyed by `Linux` and `macOS` — out of a contract
// that only describes this product's own variables.
const rows = [
  ...documentation.matchAll(
    /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|([^|]*)\|([^|]*)\|/gm,
  ),
]

const documented = new Set(rows.map((row) => row[1]!))

// The third cell, when it is a single backticked value. `—` means the variable
// has no default, and a prose cell like `platform-dependent` means the default
// is computed rather than copyable; neither is something `.env.example` can
// state, so neither is compared.
const documentedDefaults = new Map(
  rows.flatMap((row) => {
    const cell = row[3]!.replaceAll('\\*', '').trim()
    const literal = /^`([^`]+)`$/.exec(cell)
    return literal ? [[row[1]!, literal[1]!] as const] : []
  }),
)

// Assignments, commented or not: a variable may be listed commented out
// precisely because an empty assignment is set-but-empty, which defeats a
// default rather than selecting it. Only an uncommented one carries a value to
// compare.
const assignments = new Map(
  [...example.matchAll(/^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/gm)].map((match) => [
    match[2]!,
    match[1] === undefined ? match[3]! : undefined,
  ]),
)

test('every documented variable appears in .env.example', () => {
  expect([...documented].filter((name) => !assignments.has(name))).toEqual([])
})

test('every variable in .env.example is documented', () => {
  expect(
    [...assignments.keys()].filter((name) => !documented.has(name)),
  ).toEqual([])
})

test('a documented default is the value .env.example ships', () => {
  const disagreements = [...documentedDefaults]
    .filter(([name]) => assignments.get(name) !== undefined)
    .filter(([name, value]) => assignments.get(name) !== value)
    .map(
      ([name, value]) =>
        `${name}: documented ${value}, example ${assignments.get(name)}`,
    )

  expect(disagreements).toEqual([])
})

test('the tables are found at all, so nothing above passes vacuously', () => {
  expect(documented.size).toBeGreaterThan(10)
  expect(assignments.size).toBe(documented.size)
  expect(documentedDefaults.size).toBeGreaterThan(3)
})

// Ticket 67's first criterion: "every external dependency configured by
// environment variable, nothing hard-coded". A hostname compiled into the
// application is a deployment that silently talks to somebody else's
// infrastructure, and the failure is invisible until it is expensive.

/**
 * Every tracked source file, asked of git so that a generated or ignored file
 * is never scanned — and read from the filesystem when there is no git to ask.
 *
 * The fallback is not decoration: a release tarball has no `.git`, and neither
 * does the Docker build context (`.dockerignore` excludes it), so a top-level
 * `execFileSync` that throws would take every other test in this file down
 * with it rather than failing this one.
 */
const listed = (): string[] => {
  const directories = [
    'apps/web/app',
    'apps/web/lib',
    'apps/web/scripts',
    'packages/shared/src',
    'packages/shared/hooks',
    'packages/plugin/src',
    'packages/plugin/hooks',
  ]

  try {
    return execFileSync('git', ['ls-files', ...directories, 'apps/web/*.ts'], {
      cwd: fileURLToPath(root),
      encoding: 'utf8',
    }).split('\n')
  } catch {
    const walk = (directory: string): string[] => {
      let entries
      try {
        entries = readdirSync(new URL(`${directory}/`, root), {
          withFileTypes: true,
        })
      } catch {
        return []
      }
      return entries.flatMap((entry) =>
        entry.isDirectory()
          ? walk(`${directory}/${entry.name}`)
          : [`${directory}/${entry.name}`],
      )
    }
    return [
      ...directories.flatMap(walk),
      ...walk('apps/web').filter((path) => path.split('/').length === 3),
    ]
  }
}

const sources = listed()
  .filter((path) => /\.(ts|tsx|mjs)$/.test(path))
  .filter((path) => !path.includes('.test.'))

/**
 * Hosts that would mean a dependency was chosen at build time rather than by
 * the deployment. `127.0.0.1:3000` is deliberately not here: it is the
 * Collector's documented default for `SESSCLONE_URL`, which is the opposite
 * of hard-coded — it is what the variable falls back to when nobody set it,
 * on the one machine where that guess is right.
 *
 * The list is every provider the storage and auth documentation names, plus
 * the object stores a self-hoster is most likely to be on, plus this project's
 * own vendors: a hostname pointing at us is the same broken promise as one
 * pointing at Amazon.
 */
const HARD_CODED =
  /\b(?:[\w-]+\.)?(?:supabase\.co|supabase\.in|supabase\.com|cloudflarestorage\.com|amazonaws\.com|storage\.googleapis\.com|digitaloceanspaces\.com|wasabisys\.com|backblazeb2\.com|r2\.dev|anthropic\.com|claude\.ai|claude\.com)\b/

test('no external host is compiled into the application', () => {
  const offenders = sources.flatMap((path) => {
    const found = readFileSync(new URL(path, root), 'utf8')
      .split('\n')
      .map((line, index) => [index + 1, line] as const)
      // A comment naming a provider is documentation, not a dependency.
      .filter(([, line]) => !/^\s*(?:\/\/|\*|#)/.test(line))
      .filter(([, line]) => HARD_CODED.test(line))
    return found.map(([line]) => `${path}:${line}`)
  })

  expect(offenders).toEqual([])
})

test('the file list is found at all, so the check is not vacuous', () => {
  expect(sources.length).toBeGreaterThan(40)
  expect(sources.some((path) => path.includes('lib/storage.ts'))).toBe(true)
})
