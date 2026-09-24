import { expect, test } from 'vitest'

import { ConfirmRequest, PresignRequest } from './presign.ts'

// Ticket 104. `kind` is new, so a Collector that predates it sends none — and
// must still be read as archiving a transcript, which is all it knows how to.

const sha256 = 'a'.repeat(64)

test('a request without a kind is a transcript', () => {
  expect(PresignRequest.parse({ sessionId: 's', sha256 }).kind).toBe(
    'transcript',
  )
  expect(
    ConfirmRequest.parse({ sessionId: 's', sha256, storageKey: 'k' }).kind,
  ).toBe('transcript')
})

test('the sidecar kinds are accepted and nothing else is', () => {
  for (const kind of ['agent_meta', 'workflow_journal']) {
    expect(PresignRequest.parse({ sessionId: 's', sha256, kind }).kind).toBe(
      kind,
    )
  }
  expect(
    PresignRequest.safeParse({ sessionId: 's', sha256, kind: 'other' }).success,
  ).toBe(false)
})

// Ticket 129, ADR 0008. `layout` and `seal` are new, so a Collector that
// predates them sends neither — and keeps the whole-file path.

test('a request without a layout is whole-file', () => {
  expect(PresignRequest.parse({ sessionId: 's', sha256 }).layout).toBe('whole')
  expect(
    ConfirmRequest.parse({ sessionId: 's', sha256, storageKey: 'k' }).layout,
  ).toBe('whole')
})

test('seal names 1 to 16 planned chunks, and only on the chunked layout', () => {
  const ask = (extra: Record<string, unknown>) =>
    PresignRequest.safeParse({ sessionId: 's', sha256, ...extra }).success
  const planned = (count: number, over: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, i) => ({ seq: i + 1, sha256, ...over }))

  expect(ask({ layout: 'chunked', seal: planned(1) })).toBe(true)
  expect(ask({ layout: 'chunked', seal: planned(16) })).toBe(true)
  expect(ask({ layout: 'chunked' })).toBe(true)
  expect(ask({ layout: 'chunked', seal: planned(17) })).toBe(false)
  expect(ask({ layout: 'chunked', seal: [] })).toBe(false)
  // The old integer shape, and hashes that could not address a key.
  expect(ask({ layout: 'chunked', seal: 1 })).toBe(false)
  expect(
    ask({ layout: 'chunked', seal: planned(1, { sha256: 'A'.repeat(64) }) }),
  ).toBe(false)
  expect(ask({ layout: 'chunked', seal: planned(1, { seq: 0 }) })).toBe(false)
  expect(ask({ seal: planned(1) })).toBe(false)
  expect(ask({ layout: 'whole', seal: planned(1) })).toBe(false)
})

test('a confirm names its new chunks and the prefix hash only when chunked', () => {
  const chunk = { seq: 1, rawOffset: 0, rawLength: 1_048_600, sha256 }
  const confirm = (extra: Record<string, unknown>) =>
    ConfirmRequest.safeParse({
      sessionId: 's',
      sha256,
      storageKey: 'k',
      ...extra,
    }).success

  expect(
    confirm({ layout: 'chunked', chunks: [chunk], sealedSha256: sha256 }),
  ).toBe(true)
  expect(confirm({ layout: 'chunked' })).toBe(true)
  // A sealing pass must say what the new prefix hashes to.
  expect(confirm({ layout: 'chunked', chunks: [chunk] })).toBe(false)
  expect(confirm({ chunks: [chunk], sealedSha256: sha256 })).toBe(false)
  expect(
    confirm({
      layout: 'chunked',
      chunks: Array.from({ length: 17 }, (_, i) => ({ ...chunk, seq: i + 1 })),
      sealedSha256: sha256,
    }),
  ).toBe(false)
  expect(
    confirm({
      layout: 'chunked',
      chunks: [{ ...chunk, rawLength: 0 }],
      sealedSha256: sha256,
    }),
  ).toBe(false)
})

test('a chunk’s raw offset and length are bounded', () => {
  const chunk = { seq: 1, rawOffset: 0, rawLength: 1_048_600, sha256 }
  const confirm = (over: Record<string, unknown>) =>
    ConfirmRequest.safeParse({
      sessionId: 's',
      sha256,
      storageKey: 'k',
      layout: 'chunked',
      chunks: [{ ...chunk, ...over }],
      sealedSha256: sha256,
    }).success

  expect(confirm({ rawLength: 256 * 1024 * 1024 })).toBe(true)
  expect(confirm({ rawLength: 256 * 1024 * 1024 + 1 })).toBe(false)
  expect(confirm({ rawOffset: 2 ** 50 - 1 })).toBe(true)
  expect(confirm({ rawOffset: 2 ** 50 })).toBe(false)
})

test('a pass id is optional, and only 16 lowercase hex when sent', () => {
  const base = { sessionId: 's', sha256, storageKey: 'k' }
  expect(ConfirmRequest.parse(base).pass).toBeUndefined()
  expect(PresignRequest.parse(base).pass).toBeUndefined()
  const pass = '0123456789abcdef'
  expect(ConfirmRequest.parse({ ...base, pass }).pass).toBe(pass)
  expect(PresignRequest.parse({ ...base, pass }).pass).toBe(pass)
  for (const bad of ['0123456789ABCDEF', '0123', `${pass}0`, 7]) {
    expect(ConfirmRequest.safeParse({ ...base, pass: bad }).success).toBe(false)
    expect(PresignRequest.safeParse({ ...base, pass: bad }).success).toBe(false)
  }
})
