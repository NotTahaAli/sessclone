import { readdirSync, readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

// Ticket 77's third criterion — "the colour library never reaches the browser"
// — shipped broken and was caught by reading the built chunks: one `'use
// client'` component imported the preset list from `lib/accent.ts`, whose
// top-level `resolveAccent(CLAY_SEED)` defeats tree-shaking, and 86 kB of CAM16
// colour science went to every visitor of two settings pages.
//
// A build is too slow to assert that on every run, so this asserts the two
// properties that caused it, in the source: nothing a client component reaches
// imports the library, and the module the swatches do import has no imports at
// all.

const app = new URL('../app/', import.meta.url)

const walk = (directory: URL): URL[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    )
    if (entry.isDirectory()) return walk(child)
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')
      ? [child]
      : []
  })

test('no client component imports the colour library, directly or through a module that does', () => {
  // `lib/accent.ts` is the only importer of the library, so reaching it from a
  // client module is the whole failure — one hop is enough to check, because
  // every value import of it is what this forbids.
  const offenders = walk(app)
    .filter((file) => readFileSync(file, 'utf8').startsWith("'use client'"))
    .filter((file) => {
      // Line by line, because this repo writes no semicolons: a pattern
      // allowed to cross newlines reads two imports as one and calls a
      // type-only import a value import.
      return readFileSync(file, 'utf8')
        .split('\n')
        .some((line) =>
          /^import (?!type )[^']*from '[^']*lib\/(accent|appearance)'/.test(
            line,
          ),
        )
    })
    .map((file) => file.pathname)

  // A type-only import is erased, so it is not an offender and the regex above
  // says so explicitly rather than by accident.
  expect(offenders).toEqual([])
})

test('the module the swatches import imports nothing', () => {
  const presets = readFileSync(
    new URL('../lib/accent-presets.ts', import.meta.url),
    'utf8',
  )
  expect(presets).not.toMatch(/^import /m)
})
