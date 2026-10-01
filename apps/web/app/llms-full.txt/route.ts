import { connection } from 'next/server'

import { source, type DocsPage } from '../../lib/docs'
import { SITE_DESCRIPTION, canonical } from '../../lib/site'
import { siteFlags, siteLinks } from '../../lib/site-flags'

// The companion to `/llms.txt` (https://llmstxt.org): every docs page's
// Markdown in one file, so an assistant answering a question about SessClone
// reads the docs whole in one request instead of following each link. The
// Markdown is the build's (`includeProcessedMarkdown` in `lib/docs.ts`).
// Links follow the flags as `/llms.txt`'s do: this deployment's docs, or
// sessclone.com's where it serves none.

/**
 * A page's Markdown, made to stand alone: the `[#id]` anchors Fumadocs
 * appends to headings dropped, numeric entities it escapes back to their
 * characters, and site-relative links (Markdown or a component's `href`)
 * made absolute against `base`, since the reader has no page to resolve
 * them from.
 */
const standalone = (markdown: string, base: string) =>
  markdown
    .replace(/ \[#[\w-]+\]$/gm, '')
    .replace(/&#x([\da-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/\]\(\//g, `](${base}/`)
    .replace(/href="\//g, `href="${base}/`)
    .trim()

export async function GET() {
  await connection()
  const flags = siteFlags()
  const { docs } = siteLinks(flags)
  const href = (path: string) => (flags.docs ? canonical(path) : docs(path))
  const pages = await Promise.all(
    source
      .getPages()
      .map(async (page: DocsPage) =>
        [
          `# ${page.data.title}`,
          '',
          `Source: ${href(page.url)}`,
          ...(page.data.description ? ['', `> ${page.data.description}`] : []),
          '',
          standalone(await page.data.getText('processed'), href('')),
        ].join('\n'),
      ),
  )
  const body = [
    '# SessClone',
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    ...pages.flatMap((page) => [page, '']),
  ].join('\n')
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
