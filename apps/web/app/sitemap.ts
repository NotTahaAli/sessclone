import type { MetadataRoute } from 'next'

import { source, type DocsPage } from '../lib/docs'
import { canonical } from '../lib/site'
import { siteFlags, sitemapPaths } from '../lib/site-flags'

// The public pages and every docs page, as far as this deployment serves them
// (ticket 138: nothing a flag switches off). No `lastModified`: nothing
// records when a page last changed, and a build date on every entry tells a
// crawler nothing true.
export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page: DocsPage) => page.url)
  return sitemapPaths(siteFlags(), docs).map((path) => ({
    url: canonical(path),
  }))
}
