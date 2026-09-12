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
  // The reset below drops everything, so refuse any database not named as a
  // test one. A mistyped DATABASE_URL should fail, not empty someone's data.
  const database = new URL(process.env.DATABASE_URL!).pathname.slice(1)
  if (!database.endsWith('_test')) {
    throw new Error(`refusing to reset ${database}: not a _test database`)
  }

  // Resetting the schema rather than the tables this migration happens to
  // create means the next migration needs no edit here.
  await sql.unsafe('drop schema public cascade; create schema public')

  const dir = new URL('../../../../../supabase/migrations/', import.meta.url)
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .toSorted()
  for (const file of migrations) {
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
