import { expect, test } from 'vitest'

import { ingestOpenAPI } from './openapi.ts'

// Ticket 117. The checked-in spec is what the docs render and what a client
// generator reads, so it must be exactly what the zod schemas produce today.
// A schema change without a regenerated spec fails here; `-u` regenerates it.
test('openapi/ingest.json matches the zod schemas', async () => {
  await expect(
    `${JSON.stringify(ingestOpenAPI(), null, 2)}\n`,
  ).toMatchFileSnapshot('../openapi/ingest.json')
})
