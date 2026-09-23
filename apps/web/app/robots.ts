import type { MetadataRoute } from 'next'

import { CANONICAL_ORIGIN, isCanonicalSite } from '../lib/site'

// Only the canonical site is crawlable (see `lib/site.ts`). There, the public
// pages are open and everything behind sign-in is closed: a crawler following
// a link into the dashboard only finds the sign-in redirect.
export default function robots(): MetadataRoute.Robots {
  if (!isCanonicalSite()) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/admin',
        '/join',
        '/sign-in',
        '/costs',
        '/sessions',
        '/transcripts',
        '/turns',
        '/keys',
        '/devices',
        '/settings',
        '/more',
      ],
    },
    sitemap: `${CANONICAL_ORIGIN}/sitemap.xml`,
    host: CANONICAL_ORIGIN,
  }
}
