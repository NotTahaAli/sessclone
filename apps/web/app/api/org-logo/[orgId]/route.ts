import { z } from 'zod'

import { readAnonymously } from '../../../../lib/db'
import { orgLogo } from '../../../../lib/org-logo'

// Ticket 77: where the Org logo is fetched from, by everybody.
//
// Deliberately unauthenticated. Two of the three places the mark appears have
// no session to read — a mail client opening an invitation, and the sign-in
// page somebody reached from one — and the migration's `org_logos_read`
// records that decision against the table. A logo is a picture an Org puts in
// its own outgoing email; the only thing this URL discloses is that the Org id
// already in it has one.
//
// It does not exist on `orgs`, so a missing row is a 404 and not an empty
// image: `OrgMark` asks the database whether there is a logo before it renders
// an `<img>`, and this answering 404 is what keeps a stale `<img>` in a
// months-old email from drawing a broken frame in the middle of a sentence.

const OrgId = z.uuid()

/**
 * A year and `immutable` for a URL that carries the version — `logoPath`
 * appends the row's `updated_at`, so a replacement is a different URL and that
 * answer never has to be revalidated.
 *
 * A URL without it gets five minutes, because somebody who typed the bare path
 * (or a mail client that dropped the query string) would otherwise be holding
 * last year's logo with no way to be told.
 */
const cacheFor = (url: string) =>
  new URL(url).searchParams.has('v')
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=300'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const cache = cacheFor(request.url)
  const orgId = OrgId.safeParse((await params).orgId)
  if (!orgId.success) return new Response('no such logo', { status: 404 })

  const logo = await readAnonymously((tx) => orgLogo(tx, orgId.data))
  if (!logo) return new Response('no such logo', { status: 404 })

  // Weak would do — the bytes are the bytes — but a strong tag is what makes
  // a range request valid, and the mail clients that do partial fetches of
  // images are the reason to bother.
  const etag = `"${logo.updated_at.getTime().toString(36)}-${logo.bytes.byteLength.toString(36)}"`
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': cache },
    })
  }

  return new Response(
    // A copy, because `postgres` hands back a view over its own read buffer
    // and the response outlives the transaction.
    new Uint8Array(logo.bytes),
    {
      headers: {
        'content-type': logo.content_type,
        'content-length': String(logo.bytes.byteLength),
        'cache-control': cache,
        etag,
        // The bytes were proved to be a raster image when they were stored,
        // and the type below is the one that was parsed out of them — but a
        // browser that sniffs its way to something else would be running it
        // as that instead, on this origin.
        'x-content-type-options': 'nosniff',
        // Nothing here is a document, and nothing may frame it.
        'content-security-policy': "default-src 'none'; sandbox",
      },
    },
  )
}
