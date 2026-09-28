import type { MetadataRoute } from 'next'

import { canonical, searchIndexing } from '../lib/site'

// Crawlable only where `SEARCH_INDEXING=on` (see `lib/site.ts`). There, the
// public pages are open and everything behind sign-in is closed: a crawler following
// a link into the dashboard only finds the sign-in redirect. The sign-in,
// sign-up and invitation pages stay open on purpose: they carry `noindex`, and
// a crawler blocked here never reads it (Google indexes a blocked URL anyway).
export default function robots(): MetadataRoute.Robots {
  if (!searchIndexing()) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/admin',
        '/costs',
        '/sessions',
        '/transcripts',
        '/turns',
        '/keys',
        '/devices',
        '/settings',
        '/more',
        '/demo',
      ],
    },
    sitemap: canonical('/sitemap.xml'),
  }
}
