import { ConfirmRequest, type ConfirmResponse } from '@sessclone/shared'
import postgres from 'postgres'

import {
  ingestDb,
  presentedKey,
  resolveCaller,
  unauthenticated,
} from '../../../../lib/collector-auth'
import { presignDecision } from '../../../../lib/presign'
import {
  deleteObjects,
  storageConfigured,
  storedObject,
} from '../../../../lib/storage'

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
//    Project it excluded. The request echoes the key it uploaded to, and the
//    two are compared: a Session that moved Project between the presign and
//    the confirm has a different derived key now, and a row written then
//    would name one object while carrying another's hash and size — which the
//    unchanged guard would then make permanent.
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

  const { sessionId, sha256, storageKey, kind } = parsed.data
  const agentId = parsed.data.agentId ?? null

  let decision
  try {
    decision = await presignDecision(sql, {
      orgId: caller.orgId,
      memberId: caller.memberId,
      sessionId,
      agentId,
      kind,
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

    let stored
    try {
      ;[stored] = await sql<{ storage_key: string; size_bytes: string }[]>`
        select storage_key, size_bytes from log_artifacts
         where member_id = ${caller.memberId}
           and session_id = ${sessionId}
           and agent_id is not distinct from ${agentId}
           and kind = ${kind}
      `
    } catch (error) {
      return databaseFailure(error)
    }

    // The row is what made the decision `unchanged` — but the Member may have
    // destroyed it between the two statements (ticket 73), and a missing row
    // is the transient answer rather than a thrown assertion.
    if (!stored) {
      return Response.json({
        refused: 'not_uploaded',
        detail: 'nothing is stored for this Session any more',
      } satisfies ConfirmResponse)
    }

    return Response.json({
      stored: true,
      storageKey: stored.storage_key,
      sizeBytes: Number(stored.size_bytes),
    } satisfies ConfirmResponse)
  }

  // The bytes went to the key the presign issued; this Session now belongs
  // under `decision.storageKey`. When those differ the upload is stranded
  // under the old key and the right answer is to presign again — recording it
  // would file the wrong object and the hash guard would keep it forever.
  if (storageKey !== decision.storageKey) {
    return Response.json({
      refused: 'stale_key',
      detail: 'this Session’s Project changed since the upload was authorised',
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
  let replaced
  try {
    // `returning` the key the row held before the update: a Session that
    // moved Project has a new key, and the object at the old one would
    // otherwise sit in the bucket with no row naming it — bytes no retention
    // sweep can reach, which for a transcript means source code and sometimes
    // credentials kept forever.
    ;[replaced] = await sql<{ previous: string | null }[]>`
      with previous as (
        select storage_key from log_artifacts
         where member_id = ${caller.memberId}
           and session_id = ${sessionId}
           and agent_id is not distinct from ${agentId}
           and kind = ${kind}
      ), written as (
        insert into log_artifacts (org_id, member_id, project_id, session_id,
                                   agent_id, kind, storage_key, sha256,
                                   size_bytes)
        values (${caller.orgId}, ${caller.memberId}, ${decision.projectId},
                ${sessionId}, ${agentId}, ${kind}, ${decision.storageKey},
                ${sha256}, ${object.sizeBytes})
        on conflict (member_id, session_id, agent_id, kind) do update
           set project_id = excluded.project_id,
               storage_key = excluded.storage_key,
               sha256 = excluded.sha256,
               size_bytes = excluded.size_bytes,
               uploaded_at = now()
        returning storage_key
      )
      select (select storage_key from previous) as previous from written
    `
  } catch (error) {
    return databaseFailure(error)
  }

  if (replaced?.previous && replaced.previous !== decision.storageKey) {
    // After the row, never before: an orphaned object costs storage, and a
    // deleted object with a row still naming it costs the transcript.
    //
    // A failure here cannot fail a recorded upload, and it must not be
    // swallowed either: the row has already moved to the new key, so nothing
    // names the old object and no sweep could ever reach it — a transcript,
    // which is source code and sometimes a credential, kept forever. Recorded
    // instead, and the retention sweep deletes it (ticket 61).
    await deleteObjects([replaced.previous]).catch(async () => {
      await sql`
        insert into storage_orphans (storage_key) values (${replaced.previous})
        on conflict (storage_key) do nothing
      `.catch(() => {
        // Nothing left to do: the object stays, and the operator's bucket
        // lifecycle is the only thing that will reach it. Not worth failing an
        // upload that is recorded and complete.
      })
    })
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
  // Ticket 104's deploy window: the old three-column key outlives this code's
  // deploy until `20260923140000` drops it, and meanwhile refuses a run's
  // sidecar beside its transcript. That refusal ends by itself, so it is the
  // retry answer rather than the permanent one.
  const oldKey =
    error instanceof postgres.PostgresError &&
    error.constraint_name === 'log_artifacts_member_id_session_id_agent_id_key'
  return !oldKey && (code.startsWith('22') || code.startsWith('23'))
    ? refused(
        'the database refused this request',
        error instanceof Error ? error.message : undefined,
      )
    : Response.json(
        { error: 'the database is unavailable, retry later' },
        { status: 503 },
      )
}
