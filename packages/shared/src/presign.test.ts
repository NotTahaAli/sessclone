import { expect, test } from 'vitest'

import { ConfirmRequest, PresignRequest } from './presign.ts'

// Ticket 101. `kind` is new, so a Collector that predates it sends none — and
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
