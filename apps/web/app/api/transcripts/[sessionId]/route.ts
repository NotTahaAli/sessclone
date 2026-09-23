import { z } from 'zod'

import { asViewer } from '../../../../lib/db'
import {
  presignDownload,
  storageConfigured,
  ttl,
} from '../../../../lib/storage'
import { signedInUser } from '../../../../lib/supabase/server'
import { transcriptFiles } from '../../../../lib/transcript-files'

// Tickets 105-107: every stored file of one Session, each with a presigned GET
// the viewer's browser reads byte ranges from directly (ADR 0003 — the bytes
// never pass through here).
//
// Authorisation is `log_artifacts_read`, as for the download route: a file the
// viewer may not see is no row. A Session with no visible transcript is a 404
// whether it exists or not, so the answer leaks nothing.

const SessionId = z.string().min(1).max(200)

const notFound = () => new Response('no such transcript', { status: 404 })

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const user = await signedInUser()
  if (!user) return new Response('sign in first', { status: 401 })

  const sessionId = SessionId.safeParse((await params).sessionId)
  if (!sessionId.success) return notFound()

  const rows = await asViewer(user.id, (tx) =>
    transcriptFiles(tx, sessionId.data),
  )
  if (!rows.some((row) => row.kind === 'transcript')) return notFound()

  if (!storageConfigured()) {
    return new Response('this deployment has no storage configured', {
      status: 503,
    })
  }

  let files
  try {
    // Signing is local HMAC, not a request, so this is no query in a loop.
    files = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        kind: row.kind,
        agentId: row.agentId,
        sizeBytes: row.sizeBytes,
        uploadedAt: row.uploadedAt.toISOString(),
        url: await presignDownload(
          row.storageKey,
          row.storageKey.split('/').pop() ?? 'transcript.jsonl',
        ),
        expiresIn: ttl(),
      })),
    )
  } catch {
    return new Response('this deployment cannot sign a download right now', {
      status: 503,
    })
  }

  // The URLs are bearer credentials that expire; nothing may cache them.
  return Response.json(
    { sessionId: sessionId.data, files },
    { headers: { 'cache-control': 'no-store' } },
  )
}
