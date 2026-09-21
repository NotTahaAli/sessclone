import { revalidateTag } from 'next/cache'

import { TIERS_TAG } from '../../../../lib/tiers'

// Ticket 80: the other way the public pricing cache is cleared.
//
// The admin page calls `updateTag('tiers')`, which is a Server Action's to
// call and throws anywhere else — so a Tier edited by hand in psql, by a
// billing webhook in v2, or by whatever a self-hoster runs against their own
// database would otherwise sit behind a cache nothing invalidates.
//
// `revalidateTag(tag, 'max')` is the route-handler form, and the profile
// matters: it serves the cached page while the fresh one renders, so a burst
// of webhook calls costs one re-render rather than one per visitor waiting.
//
// A shared secret rather than a session, because the caller is a program. It
// is compared in constant time, and a deployment that has not set one refuses
// every call rather than defaulting to open — the route is a cache-clearing
// button, which is cheap to ask for repeatedly and worth nobody else holding.

export async function POST(request: Request) {
  const expected = process.env.PRICING_REVALIDATE_SECRET
  if (!expected) {
    return Response.json(
      { error: 'this deployment has no pricing revalidation secret' },
      { status: 503 },
    )
  }

  if (!matches(presentedSecret(request), expected)) {
    return Response.json({ error: 'not authorised' }, { status: 401 })
  }

  revalidateTag(TIERS_TAG, 'max')
  return Response.json({ revalidated: TIERS_TAG })
}

const presentedSecret = (request: Request) => {
  const header = request.headers.get('authorization')
  const [scheme, ...rest] = header?.trim().split(/\s+/) ?? []
  return scheme?.toLowerCase() === 'bearer' ? rest.join(' ') : ''
}

/**
 * Constant time for the length they share, and length-independent: comparing
 * with `===` leaks how much of a secret a guess got right, and comparing
 * buffers of different lengths throws rather than returning false.
 */
const matches = (presented: string, expected: string) => {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  let difference = a.length ^ b.length
  for (let index = 0; index < a.length; index += 1) {
    difference |= a[index]! ^ b[index % b.length]!
  }
  return difference === 0
}
