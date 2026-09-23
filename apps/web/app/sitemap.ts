import type { MetadataRoute } from 'next'

import { source, type DocsPage } from '../lib/docs'
import { canonical } from '../lib/site'

// The public pages and every docs page. No `lastModified`: nothing records
// when a page last changed, and a build date on every entry tells a crawler
// nothing true.
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['/', '/pricing', '/privacy', '/terms']
  const docs = source.getPages().map((page: DocsPage) => page.url)
  return [...pages, ...docs].map((path) => ({
    url: canonical(path),
  }))
}
