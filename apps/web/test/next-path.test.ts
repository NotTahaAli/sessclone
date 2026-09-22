import { expect, test } from 'vitest'

import { invitationToken, safeNext } from '../lib/auth/next-path'

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

// Ticket 77: the sign-in page resolves an invitation token out of `next` to
// show the Org's mark. `safeNext` says a path is safe to go back to; it does
// not say the path is well-formed, and `decodeURIComponent` throws on a
// malformed escape — which took the whole page down for a signed-out visitor.
test('an invitation token is read out of a join path, or refused', () => {
  const token = 'N3suaNNjvuWaGVlVMeB0S_FTea35Xee2WqVWmamKZkg'
  expect(invitationToken(`/join/${token}`)).toBe(token)
  expect(invitationToken(`/join/${encodeURIComponent(token)}`)).toBe(token)

  for (const bad of [
    null,
    '/costs',
    // A malformed escape: `decodeURIComponent` throws on this one.
    '/join/%',
    '/join/%zz',
    '/join/',
    '/join/short',
    '/join/has spaces and punctuation!',
  ]) {
    expect(invitationToken(bad), String(bad)).toBeNull()
  }
})
