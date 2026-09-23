import { z } from 'zod'

import { asViewer } from '../../../../../lib/db'
import { downloadableArtifact } from '../../../../../lib/artifacts'
import { presignDownload, storageConfigured } from '../../../../../lib/storage'
import { signedInUser } from '../../../../../lib/supabase/server'

// Ticket 60: downloading a whole Session transcript.
//
// A redirect rather than a proxy, for the same reason the upload is a
// presigned PUT (ADR 0003): a transcript is megabytes and sometimes hundreds
// of them, and streaming it through the application buys nothing but memory
// and a request timeout. So this route authorises, signs, and sends the
// browser to storage.
//
// Who may download what is not decided here. `log_artifacts_read` is
// `sessclone_visible_member_ids()`, so a Member sees their own, an Owner and
// an Admin any Member's, and a Manager only their Scope — and this route
// reads the row through `asViewer`, under that policy, with the id from the
// URL. An artifact the viewer may not see is simply no row, which is the same
// answer as an artifact that does not exist: a 404 either way, because a
// distinguishable 403 would tell somebody that a transcript they cannot see
// exists.
//
// A Route Handler and not a Server Action because a download is a GET a
// person can bookmark, retry, and hand to `curl` — and because an action
// cannot redirect a browser to another origin without a round trip through a
// page.

const Id = z.uuid()

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await signedInUser()
  // Not a redirect to sign-in: this URL is fetched as often as it is followed,
  // and a 401 is what a fetch can act on.
  if (!user) return new Response('sign in first', { status: 401 })

  const id = Id.safeParse((await params).id)
  if (!id.success) return new Response('no such transcript', { status: 404 })

  const artifact = await asViewer(user.id, (tx) =>
    downloadableArtifact(tx, id.data),
  )
  if (!artifact) return new Response('no such transcript', { status: 404 })

  // A row can outlive its bucket's configuration — a deployment that moved
  // providers, or a self-hoster mid-setup. Say so rather than signing a URL
  // that points nowhere.
  if (!storageConfigured()) {
    return new Response('this deployment has no storage configured', {
      status: 503,
    })
  }

  let url
  try {
    url = await presignDownload(
      artifact.storageKey,
      artifact.filename,
      artifact.contentType,
    )
  } catch {
    return new Response('this deployment cannot sign a download right now', {
      status: 503,
    })
  }

  // 302 and not 301: the URL expires, so nothing may cache this answer. The
  // signed URL is a bearer credential for the life of its signature, which is
  // why `Cache-Control` says so explicitly rather than relying on the status.
  return new Response(null, {
    status: 302,
    headers: { location: url, 'cache-control': 'no-store' },
  })
}
