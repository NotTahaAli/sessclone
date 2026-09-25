import { asViewer } from '../../../../lib/db'
import { storageConfigured } from '../../../../lib/storage'
import {
  ARCHIVE_BYTES,
  ARCHIVE_ENTRIES,
  archiveEntries,
  archiveList,
  parseArchiveFilter,
} from '../../../../lib/transcript-archive'
import { currentViewer, viewerLocked } from '../../../../lib/viewer'
import { streamOf, zip } from '../../../../lib/zip'

// Ticket 140: every transcript the viewer may download, as one zip.
//
// The exception to ADR 0003 that ticket asked for: a single transcript is a
// 302 to storage, but a zip of hundreds has to be written somewhere, and a
// browser cannot write one without holding it. So the bytes come through here
// — as a stream, one object at a time, pulled only as fast as the client
// reads, and dropped when it leaves (`request.signal`).
//
// Who may download what is `log_artifacts_read`, read through `asViewer` in
// the Org on the screen, as the single download reads it: the list is the
// authorisation. A GET, so the page's form is a plain download and the URL
// is one a person can retry.

export async function GET(request: Request) {
  // Ticket 119: a locked Org downloads nothing, its own included.
  if (await viewerLocked()) {
    return new Response('this Org is waiting for approval', { status: 403 })
  }
  const viewer = await currentViewer()
  if (!viewer) return new Response('sign in first', { status: 401 })

  const filter = parseArchiveFilter(new URL(request.url).searchParams)
  if (!filter.success) {
    return new Response('those filters are not ones this page sends', {
      status: 400,
    })
  }

  if (!storageConfigured()) {
    return new Response('this deployment has no storage configured', {
      status: 503,
    })
  }

  const items = await asViewer(viewer.userId, (tx) =>
    archiveList(tx, {
      orgId: viewer.orgId,
      timezone: viewer.orgTimezone,
      filter: filter.data,
    }),
  )
  if (items.length === 0) {
    return new Response('no stored transcript matches those filters', {
      status: 404,
    })
  }
  // Refused whole rather than cut short: a zip that silently stops at the
  // cap reads as all of them.
  const bytes = items.reduce((sum, item) => sum + item.sizeBytes, 0)
  if (items.length > ARCHIVE_ENTRIES || bytes > ARCHIVE_BYTES) {
    return new Response(
      `more than ${ARCHIVE_ENTRIES} transcripts or ${ARCHIVE_BYTES / 1024 ** 3} GB match; narrow the dates, people, projects or devices`,
      { status: 413 },
    )
  }

  const day = new Date().toISOString().slice(0, 10)
  return new Response(streamOf(zip(archiveEntries(items, request.signal))), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="transcripts-${day}.zip"`,
      // Source code and sometimes a credential: never kept by a cache.
      'cache-control': 'no-store',
    },
  })
}
