import { source, type DocsPage } from '../../lib/docs'
import { SITE_DESCRIPTION, canonical } from '../../lib/site'
import { siteFlags, siteLinks } from '../../lib/site-flags'

// https://llmstxt.org: a Markdown index an assistant can read in one request
// instead of crawling the docs. Built from the same page tree as `/docs`.
// Ticket 138: where this deployment serves no docs, the pages are linked on
// sessclone.com, and with no landing page there is no pricing to list.
export function GET() {
  const flags = siteFlags()
  const { docs, pricing } = siteLinks(flags)
  const href = (path: string) => (flags.docs ? canonical(path) : docs(path))
  const pages = source
    .getPages()
    .map(
      (page: DocsPage) =>
        `- [${page.data.title}](${href(page.url)})${page.data.description ? `: ${page.data.description}` : ''}`,
    )
  const body = [
    '# SessClone',
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    '## Docs',
    '',
    ...pages,
    '',
    '## Optional',
    '',
    ...(pricing ? [`- [Pricing](${canonical(pricing)})`] : []),
    '- [Source code](https://github.com/NotTahaAli/sessclone)',
    '',
  ].join('\n')
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
