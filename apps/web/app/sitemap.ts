import type { MetadataRoute } from 'next'

import { source, type DocsPage } from '../lib/docs'
import { MARKETING_PATHS, canonical } from '../lib/site'

// The public pages and every docs page. No `lastModified`: nothing records
// when a page last changed, and a build date on every entry tells a crawler
// nothing true.
export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page: DocsPage) => page.url)
  return [...MARKETING_PATHS, ...docs].map((path) => ({
    url: canonical(path),
  }))
}
