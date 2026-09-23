import type { MetadataRoute } from 'next'

import { canonical, searchIndexing, siteUrl } from '../lib/site'

// Crawlable only where `SEARCH_INDEXING=on` (see `lib/site.ts`). There, the
// public pages are open and everything behind sign-in is closed: a crawler following
// a link into the dashboard only finds the sign-in redirect.
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
    sitemap: canonical('/sitemap.xml'),
    host: siteUrl(),
  }
}
