import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { MDXComponents } from 'mdx/types'

import { openapi } from '../../lib/openapi'
import { siteHost, siteUrl } from '../../lib/site'
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

// This deployment's own address in the docs (2026-09-23), so a self-hosted
// copy's docs name the self-hosted copy: `NEXT_PUBLIC_APP_URL`, read at build
// time like every `NEXT_PUBLIC_` variable.

/** `https://sessclone.example`, inline in prose. */
const SiteUrl = () => <code>{siteUrl()}</code>

/** `sessclone.example`, inline in prose. */
const SiteHost = () => <code>{siteHost()}</code>

/**
 * A code block naming this deployment. A fenced block cannot hold a
 * component, so the command is a prop with `$SITE_URL` and `$SITE_HOST` in
 * it, highlighted on the server by Fumadocs' own `ServerCodeBlock`
 * (fumadocs-ui/components/codeblock.rsc; Context7, 2026-09-23). `'use cache'`
 * on a component is Next's own pattern (node_modules/next/dist/docs, use-cache).
 */
async function SiteCode({ code, lang }: { code: string; lang: string }) {
  // Cached, because Shiki reads the clock while it highlights, and a Cache
  // Components prerender refuses an uncached `Date.now()`. The inputs are
  // the props and a build-time variable, so a cached block is never stale.
  'use cache'
  return (
    <ServerCodeBlock
      lang={lang}
      code={code
        .replaceAll('$SITE_URL', siteUrl())
        .replaceAll('$SITE_HOST', siteHost())}
    />
  )
}

export const mdxComponents = {
  ...defaultMdxComponents,
  APIReference,
  SiteUrl,
  SiteHost,
  SiteCode,
} satisfies MDXComponents
