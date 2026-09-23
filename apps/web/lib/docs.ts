import { loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'

// Ticket 116. The guides and the API reference under `/docs`, from
// `content/docs`. The macro compiles the MDX at build time, so there is no
// `source.config.ts` and no generated `.source` directory to keep in sync.
const docs = defineDocs({ dir: 'content/docs' })

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
})

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>
