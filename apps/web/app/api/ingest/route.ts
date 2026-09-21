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
//    statement rather than between them. The schema refuses blank strings for
//    every column the tables check with `length(btrim(…)) > 0`, so a report
//    the database would refuse is refused here, before anything is written.
//    What the schema cannot foresee — a counter that overflows `integer`, a
//    constraint added later — is caught below, and the writes are one
//    transaction so that "exactly as it was" holds for those too.
// 2. Idempotence is by conflict, never by prior lookup (ADR 0006). Turns go
//    in with `on conflict … do nothing` against `turns_identity_key`. Nothing
//    reads first to decide whether to write: two Collectors on one machine
//    would both read "absent" and both insert, and it would double the round
//    trips on the hottest path in the product.
// 3. This route writes as the owner/service connection, not `asViewer`
//    (ADR 0001). `turns` deliberately carries no insert policy, so there is no
//    policy to satisfy here and nothing the browser can reach that writes one.
//    That is a *different role* from the dashboard's: `DATABASE_URL` points at
//    `sessclone_app`, which owns nothing and has no insert grant on `turns` or
//    `log_artifacts`, so reusing it here answers every report with
//    `permission denied for table turns` (docs/configuration.md § Database).
//
// The whole batch is a handful of round trips regardless of its size: resolve
// the Member, upsert the Device, upsert every Project at once, then the Turns
// in as few statements as Postgres's parameter limit allows. A statement per
// Turn would be a query in a loop (AGENTS.md); a statement per chunk is not.

let client: postgres.Sql | undefined

// Lazily, and once: a connection per request would exhaust the pool under any
// load, and one opened at module scope would connect during `next build`.
const db = () => {
  // Its own variable, and deliberately no fallback to `DATABASE_URL`. That
  // variable is the dashboard's `sessclone_app`, which owns nothing so that
  // the policies apply to it — and which has no insert grant on `turns` or
  // `log_artifacts`. Falling back to it would make a correctly configured
  // deployment fail on every report, and a *mis*configured one (both pointed
  // at the owning role) work, which is the mistake the split exists to make
  // impossible. As in `lib/db.ts`, say what is missing rather than letting
  // `postgres(undefined)` connect to localhost as the OS user.
  const url = process.env.INGEST_DATABASE_URL
  if (!url) throw new Error('INGEST_DATABASE_URL is not set')
  return (client ??= postgres(url))
}

const refused = (error: string, detail?: string) =>
  Response.json({ error, detail }, { status: 400 })

// What the database refused, and what the Collector should do about it. The
// two cases want opposite behaviour, so they get different statuses:
//
//  - The database refused *this data* — a data exception (SQLSTATE class 22,
//    e.g. a counter past `integer`) or an integrity violation (class 23).
//    Re-sending the identical bytes earns the identical refusal forever, and
//    a Collector that retries forever never advances its cursor. So it is a
//    400, the same "this report is bad, move on" the schema refusal gives,
//    with the database's own message as the detail so it can be acted on.
//  - Anything else — a dropped connection, a shutdown, an exhausted pool — is
//    the deployment's problem rather than the batch's, and the batch is still
//    good. That is a 503, which is the Collector's "queue it and retry".
//
// Either way the transaction rolled back and nothing was written.
const databaseFailure = (error: unknown) => {
  const code = error instanceof postgres.PostgresError ? error.code : ''
  return code.startsWith('22') || code.startsWith('23')
    ? refused(
        'the database refused this batch',
        error instanceof Error ? error.message : undefined,
      )
    : Response.json(
        { error: 'the database is unavailable, retry this batch later' },
        { status: 503 },
      )
}

// 23 columns a row against Postgres's 65534 bind parameters is 2849 rows a
// statement, and postgres.js does not chunk: a bigger batch throws
// `MAX_PARAMETERS_EXCEEDED`, the Collector re-sends the identical batch, and
// its cursor never moves. Queue drains and `SessionStart` sweeps are exactly
// the case the design expects (supabase/migrations/…_collection.sql), so the
// insert is chunked. 1000 leaves room under the cap for a column added later
// (23 000 of 65 534) and is still one statement for any ordinary report.
const TURNS_PER_STATEMENT = 1000

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = IngestPayload.safeParse(body)
  if (!parsed.success) {
    // The first issue, with its path: a batch refused for being past a limit
    // says which limit and where, rather than leaving a Collector author to
    // guess from a bare 400.
    const [issue] = parsed.error.issues
    return refused(
      'not an ingest payload',
      issue && `${issue.path.join('.') || 'payload'}: ${issue.message}`,
    )
  }

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

  // One transaction around every write. Without it a batch that passes the
  // schema and fails a database check — a constraint the schema does not
  // mirror, a counter past `integer` — leaves the Device and the Project rows
  // behind and reports nothing about them, which contradicts rule 1 above.
  try {
    await sql.begin(async (tx) => {
      // `do update` rather than `do nothing`, so `last_seen_at` moves on a
      // report from a Device that already exists — and so the statement
      // returns its id either way, which `do nothing` would not.
      const [row] = await tx<{ id: string }[]>`
        insert into devices (member_id, key, nickname)
        values (${memberId}, ${device.key}, ${device.nickname ?? null})
        on conflict (member_id, key) do update set last_seen_at = now()
        returning id
      `
      const deviceId = row!.id

      // One statement for every Project in the batch. Deduplicated by key
      // first: two reports from one repository would otherwise make
      // `do update` touch a row twice in one statement, which Postgres
      // refuses.
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

      // Scoped to the Org that the *Member* belongs to, never to one named in
      // the payload — which is what makes filing a Turn across an Org
      // boundary unrepresentable rather than merely checked. Two Orgs cloning
      // one repository get one Project row each.
      const projects = await tx<{ id: string; key: string }[]>`
        insert into projects ${tx(projectRows, 'org_id', 'key', 'remote')}
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
          // An entry may carry no timestamp while carrying usage, and the
          // column is not null. Arrival time is the honest fallback: it is
          // late rather than wrong, and it keeps the Turn in the Org's spend.
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

      // A bounded number of statements, not a query in a loop: the loop is
      // over *chunks* of the batch, one statement each, because a single
      // statement cannot carry more than 65534 bind parameters (see
      // TURNS_PER_STATEMENT). An ordinary report is one iteration; a queue
      // drain is a handful.
      for (let at = 0; at < turnRows.length; at += TURNS_PER_STATEMENT) {
        const chunk = turnRows.slice(at, at + TURNS_PER_STATEMENT)

        // The conflict target is ADR 0006's key — the columns
        // `turns_identity_key` is built on — so the dedup is that index rather
        // than a clause that happens to agree with one. It is an index and not
        // a named constraint, so the target is inferred from the columns.
        // One statement per chunk, in order, on the transaction's single
        // connection — sequential on purpose, not a missed `Promise.all`.
        // oxlint-disable-next-line no-await-in-loop
        await tx`
          insert into turns ${tx(chunk)}
          on conflict (member_id, session_id, agent_id, message_id) do nothing
        `
      }
    })
  } catch (error) {
    return databaseFailure(error)
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
