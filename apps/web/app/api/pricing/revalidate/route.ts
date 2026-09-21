import { createHash, timingSafeEqual } from 'node:crypto'

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
 * Constant time, and length-independent. Comparing with `===` leaks how much
 * of a secret a guess got right; comparing buffers of different lengths makes
 * `timingSafeEqual` throw, so both sides are hashed first — digests are always
 * 32 bytes, and a hash of the wrong secret is as wrong as the secret is.
 */
const matches = (presented: string, expected: string) =>
  timingSafeEqual(digest(presented), digest(expected))

const digest = (value: string) => createHash('sha256').update(value).digest()
