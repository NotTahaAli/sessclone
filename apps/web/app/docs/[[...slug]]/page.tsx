import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page'
import { notFound } from 'next/navigation'

import { source } from '../../../lib/docs'
import { canonical } from '../../../lib/site'
import { mdxComponents } from '../mdx-components'

type Props = { params: Promise<{ slug?: string[] }> }

export default async function Page({ params }: Props) {
  const page = source.getPage((await params).slug)
  if (!page) notFound()
  const MDX = page.data.body
  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={mdxComponents} />
      </DocsBody>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata({ params }: Props) {
  const page = source.getPage((await params).slug)
  if (!page) notFound()
  return {
    title: `${page.data.title} · Docs`,
    alternates: { canonical: canonical(page.url) },
    description: page.data.description,
  }
}
