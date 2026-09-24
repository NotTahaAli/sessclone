import { ConfirmRequest, type ConfirmResponse } from '@sessclone/shared'
import postgres from 'postgres'

import {
  ingestDb,
  presentedKey,
  resolveCaller,
  unauthenticated,
} from '../../../../lib/collector-auth'
import { presignDecision, type Sealed } from '../../../../lib/presign'
import {
  chunkKey,
  chunkKeysBeside,
  storageConfigured,
  storedObject,
  tailChunks,
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

/** Deflate's worst-case expansion: raw bytes per stored byte, at most. */
const MAX_DEFLATE_RATIO = 1032

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

  // ADR 0008: only a transcript chunks, and the presign answered any other
  // kind as whole — so chunks named for one were never authorised.
  const chunked = parsed.data.layout === 'chunked' && kind === 'transcript'
  if (!chunked && parsed.data.chunks?.length) {
    return refused(
      'not a confirm request',
      'chunks: only a transcript is stored in chunks',
    )
  }

  // ADR 0008: a pass that ends here without being recorded — refused, lost
  // a race, unchanged — leaves every key it PUT to unnamed. Those keys move
  // from the pending ledger into `storage_orphans` for the sweep, which
  // deletes each once no row names it. Only this Member's pending keys: a
  // key is a claim, and the ledger is what says this Member was issued it.
  const named = [
    storageKey,
    ...(chunked ? chunkKeysBeside(storageKey, parsed.data.chunks ?? []) : []),
  ]
  const giveUp = async (response: Response) => {
    await sql`
      with gone as (
        delete from log_upload_pending
         where member_id = ${caller.memberId}
           and storage_key = any(${named})
        returning storage_key
      )
      insert into storage_orphans (storage_key)
      select storage_key from gone
      on conflict (storage_key) do nothing
    `.catch(() => {
      // The ledger still holds them, and the sweep takes them once they
      // expire; not worth turning a refusal into an error.
    })
    return response
  }

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
      return giveUp(
        Response.json({
          refused: decision.refusal,
          detail: decision.detail,
        } satisfies ConfirmResponse),
      )
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
      return giveUp(
        Response.json({
          refused: 'not_uploaded',
          detail: 'nothing is stored for this Session any more',
        } satisfies ConfirmResponse),
      )
    }

    // This pass's own keys are nobody's: the row names an earlier pass's.
    return giveUp(
      Response.json({
        stored: true,
        storageKey: stored.storage_key,
        sizeBytes: Number(stored.size_bytes),
      } satisfies ConfirmResponse),
    )
  }

  // ADR 0008. What this pass sealed, if it chunks at all: the chunks follow
  // on from what the row holds, and the tail is keyed by how many chunks
  // precede it — so the key the bytes went to says which pass this is. Its
  // nonce is the presign's, and any nonce is this Member's own key.
  const chunks = chunked ? (parsed.data.chunks ?? []) : []
  const { sealed, path } = decision
  const tailKey = storageKey
  const at = chunked
    ? tailChunks(path, storageKey)
    : storageKey === decision.storageKey
      ? 0
      : null

  // The bytes went to the key the presign issued; this Session now belongs
  // under a tail after `sealed.chunks + chunks.length` chunks. When those
  // differ the upload is stranded and the right answer is to presign again —
  // recording it would file the wrong object and the hash guard would keep
  // it forever. A key that is still this Session's own tail is a seq that
  // moved on (`stale_chunks`); any other is a Session that moved Project
  // (`stale_key`).
  if (at !== (chunked ? sealed.chunks + chunks.length : 0)) {
    return giveUp(
      chunked && at !== null
        ? staleChunks()
        : Response.json({
            refused: 'stale_key',
            detail:
              'this Session’s Project changed since the upload was authorised',
          } satisfies ConfirmResponse),
    )
  }
  if (!followsOn(sealed, chunks)) return giveUp(staleChunks())

  // Every size from storage, never from the request (ADR 0003): each new
  // chunk's stored size and the tail's raw size, at most 17 HEADs at once.
  // Content-addressed: a chunk confirmed with other bytes than it was
  // presigned for names a key nothing was PUT to, and is `not_uploaded`.
  const keys = [
    ...chunks.map((chunk) => chunkKey(path, chunk.seq, chunk.sha256)),
    tailKey,
  ]
  let objects
  try {
    objects = await Promise.all(keys.map((each) => storedObject(each)))
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

  if (objects.some((object) => !object)) {
    // The transient refusal on this route. An upload that never landed, or a
    // provider that has not made it visible yet. The next pass presigns again,
    // which records its keys as pending once more.
    return giveUp(
      Response.json({
        refused: 'not_uploaded',
        detail: 'no object is stored under this Session’s key yet',
      } satisfies ConfirmResponse),
    )
  }

  // The raw lengths are the Collector's word, and they become `size_bytes`.
  // Deflate cannot expand past about 1032 to 1, so a chunk claiming more raw
  // bytes than its stored size could inflate to was never those bytes.
  const inflated = chunks.findIndex(
    (chunk, index) =>
      chunk.rawLength > objects[index]!.sizeBytes * MAX_DEFLATE_RATIO,
  )
  if (inflated !== -1) {
    return giveUp(
      refused(
        'not a confirm request',
        `chunks.${inflated}.rawLength: more than its stored bytes inflate to`,
      ),
    )
  }

  const tail = objects.at(-1)!
  const sealedBytes =
    chunks.reduce((sum, chunk) => sum + chunk.rawLength, 0) + sealed.bytes
  const sealedSha256 = chunks.length
    ? parsed.data.sealedSha256!
    : chunked
      ? sealed.sha256
      : null
  // Raw bytes, chunks plus tail: what a download yields (ADR 0008).
  const sizeBytes = (chunked ? sealedBytes : 0) + tail.sizeBytes

  try {
    await sql.begin(async (tx) => {
      // One confirm of this Session's object at a time. A row lock is not
      // enough: a first upload has no row to lock, and two first inserts
      // racing meet on `storage_key`'s unique index as a 23505 instead of on
      // the conflict target. Held to the commit, so the second confirm sees
      // what the first sealed. A hash collision only serialises two
      // unrelated Sessions for a moment.
      await tx`
        select pg_advisory_xact_lock(hashtextextended(
          ${`${caller.memberId}:${sessionId}:${agentId ?? ''}:${kind}`}, 0))
      `
      const [current] = await tx<
        {
          id: string
          storage_key: string
          sealed_bytes: string
          chunks: number
        }[]
      >`
        select artifact.id, artifact.storage_key, artifact.sealed_bytes,
               (select count(*)::int from log_artifact_chunks chunk
                 where chunk.artifact_id = artifact.id) as chunks
          from log_artifacts artifact
         where member_id = ${caller.memberId}
           and session_id = ${sessionId}
           and agent_id is not distinct from ${agentId}
           and kind = ${kind}
      `

      // What the presign read may have moved on since: another pass sealed
      // in between. The same test `presignDecision` makes, on the locked row:
      // chunks count only while the tail sits where they would put it.
      if (chunked) {
        const holds =
          current &&
          current.chunks > 0 &&
          tailChunks(path, current.storage_key) === current.chunks
        const still = holds
          ? current.chunks === sealed.chunks &&
            Number(current.sealed_bytes) === sealed.bytes
          : sealed.chunks === 0
        if (!still) throw new StaleChunks()
      }

      // A whole-file pass — every older Collector's — clears the chunks: its
      // file would otherwise be read after them as a duplicate. So does a
      // chunked pass starting again from zero, whose old chunks sit under a
      // Project the Session left. Their objects are queued for the sweep below.
      const dropped =
        current && (!chunked || sealed.chunks === 0)
          ? await tx<{ storage_key: string }[]>`
              delete from log_artifact_chunks where artifact_id = ${current.id}
              returning storage_key
            `
          : []

      // One row per Session — or per Agent Run within one — updated in place
      // as the Session grows (`log_artifacts`' own unique key). The conflict
      // target is the Session's identity; `storage_key` is derived from it,
      // so an upload whose Project changed mid-Session (ticket 09) moves the
      // row to the new key rather than writing a second one.
      const [artifact] = await tx<{ id: string }[]>`
        insert into log_artifacts (org_id, member_id, project_id, session_id,
                                   agent_id, kind, storage_key, sha256,
                                   size_bytes, sealed_bytes, sealed_sha256)
        values (${caller.orgId}, ${caller.memberId}, ${decision.projectId},
                ${sessionId}, ${agentId}, ${kind}, ${tailKey}, ${sha256},
                ${sizeBytes}, ${chunked ? sealedBytes : 0}, ${sealedSha256})
        on conflict (member_id, session_id, agent_id, kind) do update
           set project_id = excluded.project_id,
               storage_key = excluded.storage_key,
               sha256 = excluded.sha256,
               size_bytes = excluded.size_bytes,
               sealed_bytes = excluded.sealed_bytes,
               sealed_sha256 = excluded.sealed_sha256,
               uploaded_at = now()
        returning id
      `

      // Every key recorded here must still be pending: issued to this
      // Member by a presign, and not yet swept as expired. The sweep takes an
      // expired key in a transaction that holds its row until the object is
      // gone, so this waits for it and then finds nothing — rather than
      // recording a row whose object the sweep is deleting.
      const taken = await tx`
        delete from log_upload_pending
         where member_id = ${caller.memberId}
           and storage_key = any(${keys})
        returning storage_key
      `
      if (taken.length !== keys.length) throw new NotPending()

      // A key recorded here is live again, whatever an earlier replace
      // queued: the sweep must not delete it (by its primary key).
      await tx`
        delete from storage_orphans where storage_key = any(${keys})
      `

      if (chunks.length > 0) {
        await tx`
          insert into log_artifact_chunks ${tx(
            chunks.map((chunk, index) => ({
              artifact_id: artifact!.id,
              member_id: caller.memberId,
              seq: chunk.seq,
              raw_offset: chunk.rawOffset,
              raw_length: chunk.rawLength,
              stored_bytes: objects[index]!.sizeBytes,
              sha256: chunk.sha256,
              storage_key: keys[index]!,
            })),
          )}
        `
      }

      // `previous` is the key the row held before: a moved tail, or a
      // Session that moved Project, leaves an object no row names. Never a
      // key this pass just wrote: the whole-file key every zero-chunk pass
      // reuses, or a chunk resealed with the same bytes.
      //
      // Queued for the sweep in this transaction rather than deleted after
      // it: the sweep deletes a key only while no row or pending upload
      // names it, so one a later pass names again is kept, and a failed
      // delete cannot lose track of the object.
      const replaced = [
        ...dropped.map((row) => row.storage_key),
        ...(current ? [current.storage_key] : []),
      ].filter((each) => !keys.includes(each))
      if (replaced.length > 0) {
        await tx`
          insert into storage_orphans ${tx(replaced.map((storage_key) => ({ storage_key })))}
          on conflict (storage_key) do nothing
        `
      }
    })
  } catch (error) {
    if (
      error instanceof StaleChunks ||
      (error instanceof postgres.PostgresError &&
        error.code === '23505' &&
        error.table_name === 'log_artifact_chunks')
    ) {
      return giveUp(staleChunks())
    }
    if (error instanceof NotPending) {
      return giveUp(
        Response.json({
          refused: 'not_uploaded',
          detail: 'this upload was not authorised, or its authorisation lapsed',
        } satisfies ConfirmResponse),
      )
    }
    return databaseFailure(error)
  }

  return Response.json({
    stored: true,
    storageKey: tailKey,
    sizeBytes,
  } satisfies ConfirmResponse)
}

/** Thrown inside the transaction to roll it back as `stale_chunks`. */
class StaleChunks extends Error {}

/** Thrown inside the transaction when a key it records is not pending. */
class NotPending extends Error {}

const staleChunks = () =>
  Response.json({
    refused: 'stale_chunks',
    detail: 'what is sealed moved on since the upload was authorised',
  } satisfies ConfirmResponse)

/**
 * Whether the new chunks start at the row's next seq and sealed bytes, and
 * run on from each other with no gap in seq or in raw bytes.
 */
const followsOn = (
  sealed: Sealed,
  chunks: { seq: number; rawOffset: number; rawLength: number }[],
) => {
  let seq = sealed.chunks + 1
  let offset = sealed.bytes
  for (const chunk of chunks) {
    if (chunk.seq !== seq || chunk.rawOffset !== offset) return false
    seq += 1
    offset += chunk.rawLength
  }
  return true
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
