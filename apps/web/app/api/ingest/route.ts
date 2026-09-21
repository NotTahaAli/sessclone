import { IngestPayload, type IngestResponse } from '@sessclone/shared'
import postgres from 'postgres'

// Ticket 31: the endpoint the Collector reports to.
//
// Three rules from the ADRs shape everything below.
//
// 1. The payload is validated against the shared zod schema *before any
//    write* (AGENTS.md: validate at trust boundaries). A malformed report is
//    a 400 and leaves the database exactly as it was — including the Device
//    and Project rows, which is why parsing happens before the first
//    statement rather than between them.
// 2. Idempotence is by conflict, never by prior lookup (ADR 0006). Turns go
//    in with `on conflict … do nothing` against `turns_identity_key`. Nothing
//    reads first to decide whether to write: two Collectors on one machine
//    would both read "absent" and both insert, and it would double the round
//    trips on the hottest path in the product.
// 3. This route writes as the owner/service connection, not `asViewer`
//    (ADR 0001). `turns` deliberately carries no insert policy, so there is no
//    policy to satisfy here and nothing the browser can reach that writes one.
//
// The whole batch is four round trips regardless of its size: resolve the
// Member, upsert the Device, upsert every Project at once, insert every Turn
// at once. A statement per Turn would be a query in a loop (AGENTS.md).

let client: postgres.Sql | undefined

// Lazily, and once: a connection per request would exhaust the pool under any
// load, and one opened at module scope would connect during `next build`.
const db = () => {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return (client ??= postgres(url))
}

const refused = (error: string) => Response.json({ error }, { status: 400 })

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = IngestPayload.safeParse(body)
  if (!parsed.success) return refused('not an ingest payload')

  const { memberId, device, reports } = parsed.data
  const sql = db()

  // ticket 34 — the seam. The Member arrives in the payload and is only
  // *resolved* here, never trusted: this is explicitly not authentication and
  // does not pretend to be. Ticket 34 replaces this lookup with one that
  // verifies an API key by hash, and the rest of this route does not change,
  // because everything below already takes the Org from the resolved Member
  // rather than from anything the caller said. A revoked key, a removed
  // Member and a rate limit are all that ticket's; an unknown id is refused
  // here only so a bad report fails as a 400 rather than as a foreign key
  // violation.
  const [member] = await sql<{ org_id: string }[]>`
    select org_id from members where id = ${memberId}
  `
  if (!member) return refused('unknown member')
  const orgId = member.org_id

  // `do update` rather than `do nothing`, so `last_seen_at` moves on a report
  // from a Device that already exists — and so the statement returns its id
  // either way, which `do nothing` would not.
  const [row] = await sql<{ id: string }[]>`
    insert into devices (member_id, key, nickname)
    values (${memberId}, ${device.key}, ${device.nickname ?? null})
    on conflict (member_id, key) do update set last_seen_at = now()
    returning id
  `
  const deviceId = row!.id

  // One statement for every Project in the batch. Deduplicated by key first:
  // two reports from one repository would otherwise make `do update` touch a
  // row twice in a single statement, which Postgres refuses.
  const projectRows = [
    ...new Map(
      reports.map((report) => [
        report.project.key,
        {
          org_id: orgId,
          key: report.project.key,
          remote: report.project.remote,
        },
      ]),
    ).values(),
  ]

  // Scoped to the Org that the *Member* belongs to, never to one named in the
  // payload — which is what makes filing a Turn across an Org boundary
  // unrepresentable rather than merely checked. Two Orgs cloning one
  // repository get one Project row each.
  const projects = await sql<{ id: string; key: string }[]>`
    insert into projects ${sql(projectRows, 'org_id', 'key', 'remote')}
    on conflict (org_id, key) do update
      set last_seen_at = now(),
          remote = coalesce(excluded.remote, projects.remote)
    returning id, key
  `
  const projectIds = new Map(projects.map(({ id, key }) => [key, id]))

  const turnRows = reports.flatMap((report) =>
    report.turns.map((turn) => ({
      org_id: orgId,
      member_id: memberId,
      device_id: deviceId,
      project_id: projectIds.get(report.project.key)!,
      session_id: turn.sessionId,
      agent_id: turn.agentId,
      message_id: turn.messageId,
      // An entry may carry no timestamp while carrying usage, and the column
      // is not null. Arrival time is the honest fallback: it is late rather
      // than wrong, and it keeps the Turn in the Org's spend.
      occurred_at: turn.timestamp ?? new Date().toISOString(),
      input_tokens: turn.usage.inputTokens,
      output_tokens: turn.usage.outputTokens,
      cache_read_input_tokens: turn.usage.cacheReadInputTokens,
      cache_creation_input_tokens: turn.usage.cacheCreationInputTokens,
      cache_creation_5m_input_tokens: turn.usage.cacheCreation5mInputTokens,
      cache_creation_1h_input_tokens: turn.usage.cacheCreation1hInputTokens,
      thinking_tokens: turn.usage.thinkingTokens,
      web_search_requests: turn.usage.webSearchRequests,
      web_fetch_requests: turn.usage.webFetchRequests,
      model: turn.model,
      service_tier: turn.serviceTier,
      speed: turn.speed,
      inference_geo: turn.inferenceGeo,
      client_version: turn.clientVersion,
      complete: turn.complete,
    })),
  )

  if (turnRows.length > 0) {
    // The conflict target is ADR 0006's key — the columns `turns_identity_key`
    // is built on — so the dedup is that index rather than a clause that
    // happens to agree with one. It is an index and not a named constraint,
    // so the target is inferred from the columns.
    await sql`
      insert into turns ${sql(turnRows)}
      on conflict (member_id, session_id, agent_id, message_id) do nothing
    `
  }

  // What the Collector advances its cursor to. The count is Turns *received*,
  // not rows inserted: a re-report stores nothing and must still move the
  // cursor, and `do nothing` deliberately does not say which it was.
  const accepted: IngestResponse = {
    accepted: reports.map((report) => ({
      sessionId: report.sessionId,
      agentId: report.agentId,
      turns: report.turns.length,
      cursor: report.cursor,
    })),
  }

  return Response.json(accepted)
}
