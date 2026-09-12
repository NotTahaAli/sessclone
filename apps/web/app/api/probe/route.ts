import postgres from 'postgres'
import { z } from 'zod'

// Ticket 02's tracer bullet: the narrowest route that proves a Stop hook can
// reach the database. Ticket 22 replaces it with the real ingest route — an
// API key, the full turn payload, and the dedup index doing the work.
const ProbeRow = z.object({ sessionId: z.string().min(1) })

let client: postgres.Sql | undefined

// Lazily, and once: a connection per request would exhaust the pool under any
// load, and one opened at module scope would connect during `next build`.
const db = () => {
  // `postgres(undefined)` silently falls back to localhost and the OS user, so
  // a forgotten variable surfaces as `role "..." does not exist` three layers
  // down. Say what is missing instead.
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return (client ??= postgres(url))
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const row = ProbeRow.safeParse(body)
  if (!row.success) {
    return Response.json({ error: 'not a probe row' }, { status: 400 })
  }

  await db()`insert into probe_rows (session_id) values (${row.data.sessionId})`

  return Response.json({ stored: true }, { status: 201 })
}
