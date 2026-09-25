import { revalidateTag } from 'next/cache'

import { presentedBearer, secretMatches } from '../../../../lib/bearer'
import { ingestDb } from '../../../../lib/collector-auth'
import { DEMO_CACHE_TAG, demoEnabled } from '../../../../lib/demo'
import { presignedStore, refreshDemo } from '../../../../lib/demo-refresh'
import { storageConfigured } from '../../../../lib/storage'

// Ticket 137: the daily job that keeps the demo's data inside its last 60
// days. Guarded like the retention sweep beside it: a shared secret compared
// in constant time, and a deployment with no secret refuses every call.
//
// Vercel Cron calls it with GET and `Authorization: Bearer $CRON_SECRET`
// (`apps/web/vercel.json`); a self-hoster's own scheduler sends the same. It
// no-ops unless `ENABLE_DEMO=true`, and the first call backfills the whole window.

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
      storageConfigured() ? presignedStore : null,
    )
    // The demo's cached reads are keyed by day, but a day can be read before
    // this has seeded it: expire them whenever the data changed. At once, not
    // 'max' (stale-while-revalidate), or the first visitor after a refresh
    // is served the old day. `updateTag` would, but throws outside a Server
    // Action; `{ expire: 0 }` is the Route Handler form (Next.js 16 docs).
    if (refreshed && (refreshed.seeded > 0 || refreshed.pruned > 0)) {
      revalidateTag(DEMO_CACHE_TAG, { expire: 0 })
    }
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
