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

test('seal asks for 1 to 16 chunks, and only on the chunked layout', () => {
  const ask = (extra: Record<string, unknown>) =>
    PresignRequest.safeParse({ sessionId: 's', sha256, ...extra }).success

  expect(ask({ layout: 'chunked', seal: 1 })).toBe(true)
  expect(ask({ layout: 'chunked', seal: 16 })).toBe(true)
  expect(ask({ layout: 'chunked' })).toBe(true)
  expect(ask({ layout: 'chunked', seal: 17 })).toBe(false)
  expect(ask({ layout: 'chunked', seal: 0 })).toBe(false)
  expect(ask({ layout: 'chunked', seal: 1.5 })).toBe(false)
  expect(ask({ seal: 1 })).toBe(false)
  expect(ask({ layout: 'whole', seal: 1 })).toBe(false)
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
