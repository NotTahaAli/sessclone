import { afterEach, expect, test, vi } from 'vitest'

import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'

import {
  readBytes,
  readChunk,
  readRaw,
  wholeStream,
  type StoredFile,
} from './data'

const file = (url: string): StoredFile => ({
  id: 'f',
  kind: 'transcript',
  agentId: null,
  sizeBytes: 3,
  uploadedAt: '2026-09-23T00:00:00Z',
  url,
  expiresIn: 300,
  tailOffset: 0,
  chunks: [],
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

// ADR 0008: a transcript of two gzip chunks and a raw tail, served by a fake
// storage that knows only URLs.
const lines = ['{"n":1}\n{"n":2}\n', '{"n":3}\n', '{"n":4}\n{"n":']
const raw = lines.join('')
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const objects = new Map<string, Uint8Array<ArrayBuffer> | string>([
  ['https://c1', new Uint8Array(gzipSync(lines[0]!))],
  ['https://c2', new Uint8Array(gzipSync(lines[1]!))],
  ['https://tail', lines[2]!],
])
const chunked = (over: Partial<StoredFile> = {}): StoredFile => ({
  ...file('https://tail'),
  sizeBytes: raw.length,
  tailOffset: lines[0]!.length + lines[1]!.length,
  chunks: [
    {
      rawOffset: 0,
      rawLength: lines[0]!.length,
      sha256: sha(lines[0]!),
      url: 'https://c1',
    },
    {
      rawOffset: lines[0]!.length,
      rawLength: lines[1]!.length,
      sha256: sha(lines[1]!),
      url: 'https://c2',
    },
  ],
  ...over,
})
const storage = (store = objects) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    const body = store.get(url)
    if (body === undefined) return new Response('', { status: 403 })
    const range = new Headers(init?.headers).get('range')
    const bytes =
      typeof body === 'string' ? new TextEncoder().encode(body) : body
    const match = range && /bytes=(\d+)-(\d+)/.exec(range)
    return match
      ? new Response(bytes.slice(Number(match[1]), Number(match[2]) + 1), {
          status: 206,
        })
      : new Response(bytes, { status: 200 })
  })
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const none = async () => null

test('readChunk gunzips one chunk to its raw bytes', async () => {
  vi.stubGlobal('fetch', storage())
  expect(text(await readChunk(chunked(), 1, none))).toBe(lines[1])
})

test('readChunk refuses a chunk whose bytes do not match its hash', async () => {
  vi.stubGlobal('fetch', storage())
  const bad = chunked()
  bad.chunks[0]!.sha256 = sha('something else')
  await expect(readChunk(bad, 0, none)).rejects.toThrow(/checksum/i)
})

test('readChunk renews an expired link and reads the same chunk', async () => {
  vi.stubGlobal('fetch', storage())
  const stale = chunked()
  stale.chunks[1]!.url = 'https://expired'
  expect(text(await readChunk(stale, 1, async () => chunked()))).toBe(lines[1])
})

test('wholeStream yields every chunk, then the tail, in order', async () => {
  vi.stubGlobal('fetch', storage())
  const out = await new Response(wholeStream(chunked(), none)).text()
  expect(out).toBe(raw)
})

test('wholeStream of a whole-file row is the file', async () => {
  vi.stubGlobal('fetch', storage())
  const out = await new Response(wholeStream(file('https://tail'), none)).text()
  expect(out).toBe(lines[2])
})

test('wholeStream errors rather than yield a corrupt chunk', async () => {
  vi.stubGlobal('fetch', storage())
  const bad = chunked()
  bad.chunks[1]!.sha256 = sha('nope')
  await expect(new Response(wholeStream(bad, none)).text()).rejects.toThrow(
    /checksum/i,
  )
})

test('a renewed tail from a transcript that sealed since is refused', async () => {
  vi.stubGlobal('fetch', storage())
  const renew = async () => chunked({ tailOffset: 0, chunks: [] })
  await expect(
    readBytes(chunked({ url: 'https://gone' }), null, renew),
  ).rejects.toThrow(/Reload/)
})

test('readRaw reads a range inside the tail at its raw offsets', async () => {
  vi.stubGlobal('fetch', storage())
  const tailOffset = chunked().tailOffset
  const read = await readRaw(
    chunked(),
    { kind: 'range', start: tailOffset + 1, end: tailOffset + 3 },
    none,
  )
  expect(read.start).toBe(tailOffset + 1)
  expect(text(read.bytes)).toBe(lines[2]!.slice(1, 4))
})

test('readRaw of a chunk is cut where the loaded bytes begin', async () => {
  vi.stubGlobal('fetch', storage())
  const read = await readRaw(
    chunked(),
    { kind: 'chunk', index: 0, start: 0, end: 7 },
    none,
  )
  expect([read.start, text(read.bytes)]).toEqual([0, '{"n":1}\n'])
})

test('readRaw keeps what a server that ignores Range sent, up to the read', async () => {
  const store = new Map(objects)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(store.get(url) ?? '')),
  )
  const tailOffset = chunked().tailOffset
  const read = await readRaw(
    chunked(),
    { kind: 'range', start: tailOffset + 4, end: tailOffset + 8 },
    none,
  )
  expect(read.start).toBe(tailOffset)
  expect(text(read.bytes)).toBe(lines[2]!.slice(0, 9))
})
