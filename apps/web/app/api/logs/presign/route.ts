import { PresignRequest, type PresignResponse } from '@sessclone/shared'
import postgres from 'postgres'

import {
  ingestDb,
  presentedKey,
  resolveCaller,
  unauthenticated,
} from '../../../../lib/collector-auth'
import { presignDecision } from '../../../../lib/presign'
import {
  MAX_KEY_BYTES,
  presignUpload,
  storageConfigured,
  ttl,
} from '../../../../lib/storage'

// Ticket 58: the endpoint that authorises a transcript upload — and the five
// cases where it refuses.
//
// The bytes never come here (ADR 0003). This route says yes or no and issues a
// short-lived PUT URL; the Collector uploads straight to storage.
//
// Three things decide the answer, and none of them is in the request body:
//
// 1. **Who.** The API key, exactly as ingest has it (ticket 34): hashed,
//    looked up, and yielding a live Member and their Org. One 401 for absent,
//    malformed, unknown, revoked and removed alike, so this is not an oracle
//    for which keys exist.
// 2. **Which Project.** Resolved from the Turns already ingested for that
//    Session, never from the request. A Collector runs on the Member's
//    machine, so a Project key it sends is a claim — and honouring it would
//    let an excluded Project be archived by sending a different key, defeating
//    the only enforcement point ADR 0005 has.
// 3. **Whether.** The Tier, the Member's master switch, that Project's
//    exception, and the stored hash, in `lib/presign.ts`.
//
// Each refusal is a 200 with a code rather than an error status: they are all
// ordinary answers to a question the Collector is right to ask, and four of
// the five are a person's settings rather than a fault. A Collector that saw
// 403 would have to parse a body to tell "not opted in" from "excluded" from
// "already stored" anyway, and the transient one — the Session is not ingested
// yet — is simply "ask again later".

const refused = (error: string, detail?: string) =>
  Response.json({ error, detail }, { status: 400 })

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
  const parsed = PresignRequest.safeParse(body)
  if (!parsed.success) {
    const [issue] = parsed.error.issues
    return refused(
      'not a presign request',
      issue && `${issue.path.join('.') || 'payload'}: ${issue.message}`,
    )
  }

  // A deployment with no bucket configured has archival switched off rather
  // than half-working: say so plainly instead of issuing a URL that points
  // nowhere or throwing out of the handler.
  if (!storageConfigured()) {
    return Response.json(
      { error: 'this deployment has no storage configured' },
      { status: 503 },
    )
  }

  const { sessionId, sha256, kind } = parsed.data
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
    return Response.json({
      refused: decision.refusal,
      detail: decision.detail,
    } satisfies PresignResponse)
  }

  // The last write before the bytes move, and the only one this route makes:
  // evidence that a Collector reached the deployment, the same as ingest's.
  // Failing it must not cost the upload, so it is not awaited into the answer.
  sql`update api_keys set last_used_at = now() where id = ${caller.keyId}`.catch(
    () => {},
  )

  // Before the bytes move, not after: a key over the provider's limit is
  // refused once the whole transcript has been streamed, which is the cost
  // this route exists to save. The ids are bounded by the schema, so reaching
  // this needs a Project key long enough to be worth saying so about.
  if (Buffer.byteLength(decision.storageKey) > MAX_KEY_BYTES) {
    return refused(
      'this Session cannot be stored under a key that long',
      `${decision.storageKey.slice(0, 80)}…`,
    )
  }

  let url
  try {
    url = await presignUpload(decision.storageKey)
  } catch {
    // Signing fails for configuration reasons — a bad endpoint, credentials
    // the client rejects — so it is the same answer as no storage at all
    // rather than a stack trace out of the handler.
    return Response.json(
      { error: 'this deployment cannot sign an upload right now' },
      { status: 503 },
    )
  }

  return Response.json({
    url,
    storageKey: decision.storageKey,
    expiresIn: ttl(),
  } satisfies PresignResponse)
}

/**
 * What the database refused, and what the Collector should do about it — the
 * same split ingest makes: a refusal of this data is a 400 that will never
 * succeed on retry, and anything else is a 503 to queue and try again.
 */
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
