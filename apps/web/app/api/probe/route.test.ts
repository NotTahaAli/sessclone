import { readFileSync, readdirSync } from 'node:fs'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { POST } from './route'

// A real Postgres with the real migrations, per AGENTS.md — a fake would prove
// the handler talks to a fake.
const sql = postgres(process.env.DATABASE_URL!)

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeAll(async () => {
  const dir = new URL('../../../../../supabase/migrations/', import.meta.url)
  await sql.unsafe('drop table if exists probe_rows')
  for (const file of readdirSync(dir).toSorted()) {
    // oxlint-disable-next-line no-await-in-loop -- migrations apply in order.
    await sql.unsafe(readFileSync(new URL(file, dir), 'utf8'))
  }
})

beforeEach(async () => {
  await sql`truncate probe_rows`
})

afterAll(async () => {
  await sql.end()
})

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
