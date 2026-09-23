import { createMDX } from 'fumadocs-mdx/next'
import type { NextConfig } from 'next'

// Cache Components, for ticket 80: the public pricing section reads the Tier
// table rather than restating it, and it must not open a connection for every
// visitor to a page whose content changes a few times a year. `'use cache'`
// and `cacheTag('tiers')` are what make that read cached and invalidatable,
// and both require this flag.
const nextConfig: NextConfig = {
  cacheComponents: true,
}

// Ticket 116: `/docs` is MDX under `content/docs`, compiled by Fumadocs.
export default createMDX()(nextConfig)
