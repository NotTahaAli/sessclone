import postgres from 'postgres'
import { z } from 'zod'

// Ticket 02's tracer bullet: the narrowest route that proves a Stop hook can
// reach the database. Ticket 22 replaces it with the real ingest route — an
// API key, the full turn payload, and the dedup index doing the work.
const ProbeRow = z.object({ sessionId: z.string().min(1) })

let client: postgres.Sql | undefined

// Lazily, and once: a connection per request would exhaust the pool under any
// load, and one opened at module scope would connect during `next build`.
const db = () => (client ??= postgres(process.env.DATABASE_URL!))

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const row = ProbeRow.safeParse(body)
  if (!row.success) {
    return Response.json({ error: 'not a probe row' }, { status: 400 })
  }

  await db()`insert into probe_rows (session_id) values (${row.data.sessionId})`

  return Response.json({ stored: true }, { status: 201 })
}
