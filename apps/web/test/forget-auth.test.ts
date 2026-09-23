import { expect, test } from 'vitest'

import { forgetAuth } from '../components/openapi/playground/forget-auth'

// The docs playground's Bearer key is a live credential: what the library
// persists is removed, and storage that throws is not an error.

test('the stored auth values are removed, and nothing else is', () => {
  const stored = new Map([
    ['fumadocs-openapi-auth-bearer', '"Bearer sk_live"'],
    ['theme', 'dark'],
  ])
  const storage = { removeItem: (key: string) => void stored.delete(key) }

  forgetAuth(storage, [{ storageKey: 'fumadocs-openapi-auth-bearer' }])
  expect([...stored.keys()]).toEqual(['theme'])

  const throwing = {
    removeItem: () => {
      throw new Error('SecurityError')
    },
  }
  expect(() =>
    forgetAuth(throwing, [{ storageKey: 'fumadocs-openapi-auth-bearer' }]),
  ).not.toThrow()
})
