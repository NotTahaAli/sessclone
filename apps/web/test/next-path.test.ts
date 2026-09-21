import { expect, test } from 'vitest'

import { safeNext } from '../lib/auth/next-path'

// The sign-in callback redirects to this with a fresh session in hand, so
// anything a browser resolves to another origin gives that session away.

test('a path on this deployment is kept', () => {
  expect(safeNext('/join/abc')).toBe('/join/abc')
  expect(safeNext('/costs?view=members')).toBe('/costs?view=members')
})

test('anything a browser reads as another origin is refused', () => {
  // `//evil.example` is an absolute URL, and the backslash is the same trick.
  for (const hostile of [
    '//evil.example',
    '/\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    '',
    null,
    undefined,
    42,
  ]) {
    expect(safeNext(hostile)).toBeNull()
  }
})
