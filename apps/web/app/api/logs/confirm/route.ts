import { ConfirmRequest, type ConfirmResponse } from '@sessclone/shared'
import postgres from 'postgres'

import {
  ingestDb,
  presentedKey,
  resolveCaller,
  unauthenticated,
} from '../../../../lib/collector-auth'
import { presignDecision } from '../../../../lib/presign'
import { storageConfigured, storedObject } from '../../../../lib/storage'

// Ticket 59: the request that records an upload, after the bytes have landed.
//
// The presign route (ticket 58) authorises an upload and writes no artifact
// row, deliberately. The PUT between the two requests is the part that can
// fail — a laptop that closed, a provider that refused, a connection that cut
// halfway — and a row written before it would claim a transcript is stored
// that is not. The hash guard would then refuse to ever upload that
// transcript again, so the bytes would be permanently missing while the
// dashboard offered a download of them. So the row is written here, once the
// object is really in the bucket.
//
// Three things are not taken from the request, for the same reason as on the
// presign route: a Collector runs on the Member's machine, so everything it
// says about itself is a claim.
//
// 1. **Who** comes from the API key (ticket 34), as everywhere else.
// 2. **Where** — the object key and the Project — is re-derived by
//    `presignDecision` from the Turns already ingested, so a Collector cannot
//    file one Session's transcript under another Session's key, nor under a
//    Project it excluded.
// 3. **How big** is read back from storage. A truncated or failed upload
//    cannot overstate its own size, and the size is what the retention and
//    download surfaces show.
//
// What is still the Collector's word is the SHA-256: computing it here would
// mean downloading the transcript through the application, which is the one
// thing ADR 0003 exists to avoid. A Member who lies about it can only make
// their own next upload be skipped as unchanged.

const refused = (error: string, detail?: string) =>
  Response.json({ error, detail } satisfies ConfirmResponse, { status: 400 })

export async function POST(request: Request) {
  const presented = presentedKey(request)
  if (!presented) return unauthenticated()

  const sql = ingestDb()

  let caller
  try {
    caller = await resolveCaller(sql, presented)
  } catch (error) {
    return databaseFailure(error)
  }
  if (!caller) return unauthenticated()

  const body = await request.json().catch(() => null)
  const parsed = ConfirmRequest.safeParse(body)
  if (!parsed.success) {
    const [issue] = parsed.error.issues
    return refused(
      'not a confirm request',
      issue && `${issue.path.join('.') || 'payload'}: ${issue.message}`,
    )
  }

  if (!storageConfigured()) {
    return Response.json(
      { error: 'this deployment has no storage configured' },
      { status: 503 },
    )
  }

  const { sessionId, sha256 } = parsed.data
  const agentId = parsed.data.agentId ?? null

  let decision
  try {
    decision = await presignDecision(sql, {
      orgId: caller.orgId,
      memberId: caller.memberId,
      sessionId,
      agentId,
      sha256,
    })
  } catch (error) {
    return databaseFailure(error)
  }

  if (!decision) return unauthenticated()

  if (!decision.allowed) {
    // `unchanged` is not a refusal on this route: it means the row already
    // records exactly these bytes, which is what a Collector confirming twice
    // — a retry, a queue drained after the answer was lost — should be told
    // succeeded. Every other refusal is the same answer the presign route
    // gives, because the same switch is still off and nothing should have
    // been uploaded.
    if (decision.refusal !== 'unchanged') {
      return Response.json({
        refused: decision.refusal,
        detail: decision.detail,
      } satisfies ConfirmResponse)
    }

    const [stored] = await sql<{ storage_key: string; size_bytes: string }[]>`
      select storage_key, size_bytes from log_artifacts
       where member_id = ${caller.memberId}
         and session_id = ${sessionId}
         and agent_id is not distinct from ${agentId}
    `
    // The row is what made the decision `unchanged`, so it is there.
    return Response.json({
      stored: true,
      storageKey: stored!.storage_key,
      sizeBytes: Number(stored!.size_bytes),
    } satisfies ConfirmResponse)
  }

  let object
  try {
    object = await storedObject(decision.storageKey)
  } catch {
    // Reading it back failed for a configuration or availability reason, the
    // same class the presign route answers 503 for: the Collector retries,
    // and until it does there is no row claiming a transcript nobody can
    // fetch.
    return Response.json(
      { error: 'this deployment cannot read the uploaded object right now' },
      { status: 503 },
    )
  }

  if (!object) {
    // The transient refusal on this route. An upload that never landed, or a
    // provider that has not made it visible yet.
    return Response.json({
      refused: 'not_uploaded',
      detail: 'no object is stored under this Session’s key yet',
    } satisfies ConfirmResponse)
  }

  // One row per Session — or per Agent Run within one — updated in place as
  // the Session grows, which is what keeps one object per transcript instead
  // of a version per report (`log_artifacts`' own unique key). The conflict
  // target is the Session's identity; `storage_key` is derived from it, so an
  // upload whose Project changed mid-Session (ticket 09) moves the row to the
  // new key rather than writing a second one.
  try {
    await sql`
      insert into log_artifacts (org_id, member_id, project_id, session_id,
                                 agent_id, storage_key, sha256, size_bytes)
      values (${caller.orgId}, ${caller.memberId}, ${decision.projectId},
              ${sessionId}, ${agentId}, ${decision.storageKey}, ${sha256},
              ${object.sizeBytes})
      on conflict (member_id, session_id, agent_id) do update
         set project_id = excluded.project_id,
             storage_key = excluded.storage_key,
             sha256 = excluded.sha256,
             size_bytes = excluded.size_bytes,
             uploaded_at = now()
    `
  } catch (error) {
    return databaseFailure(error)
  }

  return Response.json({
    stored: true,
    storageKey: decision.storageKey,
    sizeBytes: object.sizeBytes,
  } satisfies ConfirmResponse)
}

/** The split ingest and presign both make: data the database refuses will
 * never succeed on retry, and anything else is worth retrying. */
const databaseFailure = (error: unknown) => {
  const code = error instanceof postgres.PostgresError ? error.code : ''
  return code.startsWith('22') || code.startsWith('23')
    ? refused(
        'the database refused this request',
        error instanceof Error ? error.message : undefined,
      )
    : Response.json(
        { error: 'the database is unavailable, retry later' },
        { status: 503 },
      )
}
