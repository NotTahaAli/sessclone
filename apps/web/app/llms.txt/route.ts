import { source, type DocsPage } from '../../lib/docs'
import { SITE_DESCRIPTION, canonical } from '../../lib/site'

// https://llmstxt.org: a Markdown index an assistant can read in one request
// instead of crawling the docs. Built from the same page tree as `/docs`.
export function GET() {
  const pages = source
    .getPages()
    .map(
      (page: DocsPage) =>
        `- [${page.data.title}](${canonical(page.url)})${page.data.description ? `: ${page.data.description}` : ''}`,
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
    `- [Pricing](${canonical('/pricing')})`,
    '- [Source code](https://github.com/NotTahaAli/sessclone)',
    '',
  ].join('\n')
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
