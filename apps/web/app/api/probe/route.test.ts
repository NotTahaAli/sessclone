import { expect, test } from 'vitest'

import { owner as sql } from '../../../test/harness'
import { POST } from './route'

// A real Postgres with the real migrations, per AGENTS.md — a fake would prove
// the handler talks to a fake. The rig is ticket 25's: `test/harness.ts`
// applies the migrations once per run, and the reset between tests is the
// harness's rather than this file's to remember.

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

test('stores the row a hook posted', async () => {
  const response = await post({ sessionId: 'abc-123' })

  expect(response.status).toBe(201)
  expect(await sql`select session_id from probe_rows`).toEqual([
    { session_id: 'abc-123' },
  ])
})

test('refuses a body that is not a probe row', async () => {
  const response = await post({ nonsense: true })

  expect(response.status).toBe(400)
  expect(await sql`select 1 from probe_rows`).toEqual([])
})
