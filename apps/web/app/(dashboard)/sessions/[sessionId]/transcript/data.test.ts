import { afterEach, expect, test, vi } from 'vitest'

import { readBytes, type StoredFile } from './data'

const file = (url: string): StoredFile => ({
  id: 'f',
  kind: 'transcript',
  agentId: null,
  sizeBytes: 3,
  uploadedAt: '2026-09-23T00:00:00Z',
  url,
  expiresIn: 300,
})

afterEach(() => vi.unstubAllGlobals())

test('an expired link that answers without CORS headers is renewed', async () => {
  // R2 sends no CORS headers on an expired presigned URL's 403, so the
  // browser reports a network error instead of the status.
  const fetch = vi.fn(async (url: string) => {
    if (url === 'https://old') throw new TypeError('Failed to fetch')
    return new Response('abc', { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)

  const read = await readBytes(file('https://old'), null, async () =>
    file('https://fresh'),
  )

  expect(new TextDecoder().decode(read.bytes)).toBe('abc')
  expect(fetch).toHaveBeenLastCalledWith('https://fresh', expect.anything())
})

test('an aborted read is not retried', async () => {
  const abort = new DOMException('aborted', 'AbortError')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw abort
    }),
  )
  const renew = vi.fn(async () => file('https://fresh'))

  await expect(readBytes(file('https://old'), null, renew)).rejects.toBe(abort)
  expect(renew).not.toHaveBeenCalled()
})
