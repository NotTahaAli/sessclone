import { presentedBearer, secretMatches } from '../../../../lib/bearer'
import { ingestDb } from '../../../../lib/collector-auth'
import { demoEnabled } from '../../../../lib/demo'
import { refreshDemo, type DemoStore } from '../../../../lib/demo-refresh'
import {
  deleteObjects,
  presignUpload,
  storageConfigured,
} from '../../../../lib/storage'

// Ticket 137: the daily job that keeps the demo's data inside its last 60
// days. Guarded like the retention sweep beside it: a shared secret compared
// in constant time, and a deployment with no secret refuses every call.
//
// Vercel Cron calls it with GET and `Authorization: Bearer $CRON_SECRET`
// (`apps/web/vercel.json`); a self-hoster's own scheduler sends the same. It
// no-ops unless `DEMO=on`, and the first call backfills the whole window.

/** The server's own upload: presigned like a Collector's (ADR 0003), so no
 * second storage code path exists. The objects are a few kilobytes each. */
const store: DemoStore = {
  put: async (key, body) => {
    const response = await fetch(await presignUpload(key), {
      method: 'PUT',
      headers: { 'content-type': 'application/x-ndjson' },
      body,
    })
    if (!response.ok) throw new Error(`storage refused ${response.status}`)
  },
  remove: deleteObjects,
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return Response.json(
      { error: 'this deployment has no cron secret' },
      { status: 503 },
    )
  }
  if (!secretMatches(presentedBearer(request), expected)) {
    return Response.json({ error: 'not authorised' }, { status: 401 })
  }
  if (!demoEnabled()) return Response.json({ demo: 'off' })

  try {
    const refreshed = await refreshDemo(
      ingestDb(),
      storageConfigured() ? store : null,
    )
    return refreshed
      ? Response.json(refreshed)
      : Response.json(
          { error: 'a refresh is already running' },
          { status: 409 },
        )
  } catch (error) {
    // Rolled back; the cause stays in the server's log, not the body.
    console.error('demo refresh failed', error)
    return Response.json(
      { error: 'the refresh did not complete; nothing was changed' },
      { status: 503 },
    )
  }
}

export const POST = GET
