import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { docsGraph, jsonLd, landingGraph, offers } from '../lib/structured-data'
import type { MarketingTier } from '../lib/tiers'
// @ts-expect-error — a plain script, deliberately outside the TypeScript build.
import { sitemapUrls, submission } from '../scripts/indexnow.mjs'

// The JSON-LD the public pages embed. Prices are the Tier rows' (ticket 80):
// these cases pin how a row becomes an Offer, above all that "Talk to us" is
// never read as free.
const tier = (key: string, over: Partial<MarketingTier>): MarketingTier => ({
  key,
  name: key,
  description: '',
  basePriceUsd: null,
  seatPriceUsd: null,
  includedSeats: 0,
  minSeats: null,
  maxSeats: null,
  retentionMaxDays: null,
  historyDays: null,
  archivalAvailable: false,
  includes: [],
  managerScopes: false,
  sso: false,
  ownRates: null,
  sortOrder: 0,
  ...over,
})

const selfHosted = tier('Self-Hosted', { basePriceUsd: 0, seatPriceUsd: 0 })
const personal = tier('Personal', { basePriceUsd: 5 })
const team = tier('Team', { seatPriceUsd: 10 })
const enterprise = tier('Enterprise', {})

const node = (
  graph: { '@graph': Record<string, unknown>[] },
  type: string,
): Record<string, unknown> | undefined =>
  graph['@graph'].find((entry) => entry['@type'] === type)

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sessclone.com'))
afterEach(() => vi.unstubAllEnvs())

describe('offers', () => {
  it('prices each Tier from its row, per seat where it has a seat price', () => {
    expect(offers([personal, team])).toMatchObject([
      {
        name: 'Personal',
        price: 5,
        priceSpecification: { price: 5, unitText: 'per month' },
      },
      {
        name: 'Team',
        price: 10,
        priceSpecification: { price: 10, unitText: 'per seat per month' },
      },
    ])
  })

  it('leaves out a "Talk to us" Tier rather than reading it as free', () => {
    expect(offers([enterprise])).toEqual([])
  })

  it('leaves out the free Self-Hosted Tier, so no $0 plan sits beside hosted ones', () => {
    expect(offers([selfHosted, personal]).map((offer) => offer.name)).toEqual([
      'Personal',
    ])
  })
})

describe('landingGraph', () => {
  const faq = [{ question: 'Q?', answer: 'A.' }]

  it('carries the publisher, the site, the product and the questions', () => {
    const graph = landingGraph({ tiers: [personal], faq })
    expect(node(graph, 'Organization')).toMatchObject({
      '@id': 'https://sessclone.com/#organization',
      sameAs: ['https://github.com/NotTahaAli/sessclone'],
    })
    expect(node(graph, 'WebSite')).toMatchObject({
      url: 'https://sessclone.com',
    })
    expect(node(graph, 'SoftwareApplication')?.offers).toHaveLength(1)
    expect(node(graph, 'FAQPage')?.mainEntity).toEqual([
      {
        '@type': 'Question',
        name: 'Q?',
        acceptedAnswer: { '@type': 'Answer', text: 'A.' },
      },
    ])
  })

  it('states no offers when the Tier table could not be read', () => {
    const graph = landingGraph({ tiers: [], faq })
    expect(node(graph, 'SoftwareApplication')).not.toHaveProperty('offers')
  })
})

describe('docsGraph', () => {
  it('places a page under Docs', () => {
    const graph = docsGraph({ url: '/docs/install', title: 'Install' })
    expect(node(graph, 'BreadcrumbList')?.itemListElement).toEqual([
      expect.objectContaining({
        position: 1,
        item: 'https://sessclone.com/docs',
      }),
      expect.objectContaining({
        position: 2,
        name: 'Install',
        item: 'https://sessclone.com/docs/install',
      }),
    ])
    expect(node(graph, 'TechArticle')).toMatchObject({
      headline: 'Install',
      url: 'https://sessclone.com/docs/install',
    })
  })

  it('gives the docs index no one-crumb trail, which Google flags', () => {
    const graph = docsGraph({ url: '/docs', title: 'Introduction' })
    expect(node(graph, 'BreadcrumbList')).toBeUndefined()
    expect(node(graph, 'TechArticle')).toMatchObject({
      headline: 'Introduction',
    })
  })
})

describe('jsonLd', () => {
  it('cannot be closed early by text in the graph', () => {
    const out = jsonLd({ text: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('<')
    expect(JSON.parse(out)).toEqual({
      text: '</script><script>alert(1)</script>',
    })
  })
})

describe('IndexNow', () => {
  it('submits the sitemap’s URLs on the site’s own host, with its key file', () => {
    const urls = sitemapUrls(
      '<urlset><url><loc>https://sessclone.com</loc></url>' +
        '<url><loc>https://sessclone.com/docs</loc></url>' +
        '<url><loc>https://elsewhere.example/x</loc></url></urlset>',
    )
    const body = submission('https://sessclone.com', urls)
    expect(body).toMatchObject({
      host: 'sessclone.com',
      urlList: ['https://sessclone.com', 'https://sessclone.com/docs'],
    })
    expect(body.keyLocation).toBe(`https://sessclone.com/${body.key}.txt`)
  })

  it('has its key file served, holding exactly the key', () => {
    const { key } = submission('https://sessclone.com', [])
    const file = new URL(`../public/${key}.txt`, import.meta.url)
    expect(readFileSync(file, 'utf8')).toBe(key)
  })
})
