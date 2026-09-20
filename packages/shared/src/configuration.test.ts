import { readFileSync } from 'node:fs'

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
