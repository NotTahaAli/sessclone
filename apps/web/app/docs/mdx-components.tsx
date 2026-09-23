import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'

import { openapi } from '../../lib/openapi'
import { OpenAPIPage } from './openapi-page'

/**
 * One API's operations, rendered from its spec. `document` is a key of
 * `lib/openapi.ts`'s input; an MDX page under `content/docs/api` names it
 * and the operations it documents.
 */
async function APIReference({
  document,
  operations,
}: {
  document: string
  operations: {
    path: string
    method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  }[]
}) {
  const { bundled } = await openapi.getSchema(document)
  // A Server Component that renders once per request; there is no re-render
  // for a fresh object to defeat.
  // oxlint-disable-next-line react-perf/jsx-no-new-object-as-prop
  return <OpenAPIPage payload={{ bundled }} operations={operations} />
}

export const mdxComponents = {
  ...defaultMdxComponents,
  APIReference,
} satisfies MDXComponents
