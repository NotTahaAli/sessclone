import { createFromSource } from 'fumadocs-core/search/server'

import { source } from '../../../lib/docs'

// Ticket 116: the docs' built-in search, where the Fumadocs search dialog asks
// by default. The index is built from the pages in memory; no external
// service.
export const { GET } = createFromSource(source, { language: 'english' })
