import { isFree } from './plans'
import { REPOSITORY, SITE_DESCRIPTION, canonical, siteUrl } from './site'
import type { MarketingTier } from './tiers'

// The schema.org graphs the public pages embed as JSON-LD: what search
// engines and answer engines read for the site's name, the product, its
// prices and the questions the landing page answers. Pure, so one unit test
// covers it (`test/structured-data.test.ts`).
//
// Prices come from the Tier rows the page already rendered, never from a
// literal here: the `tiers` table is the one source (ticket 80), and a graph
// built from the same rows cannot drift from the visible ones.

export type Faq = { question: string; answer: string }

const organizationId = () => `${siteUrl()}/#organization`

const organization = () => ({
  '@type': 'Organization',
  '@id': organizationId(),
  name: 'SessClone',
  url: siteUrl(),
  logo: `${siteUrl()}/apple-icon.png`,
  sameAs: [REPOSITORY],
})

/**
 * One Offer per Tier with a price. A "Talk to us" Tier (both prices null) has
 * none to state and is left out rather than read as free. A seat price is the
 * headline where there is one, as `shortPrice` shows it; otherwise the flat
 * monthly price.
 */
export const offers = (tiers: MarketingTier[]) =>
  tiers.flatMap((tier) => {
    const { basePriceUsd: base, seatPriceUsd: seat } = tier
    if (base === null && seat === null) return []
    const free = isFree(tier)
    const price = free ? 0 : seat ? seat : (base ?? 0)
    return [
      {
        '@type': 'Offer',
        name: tier.name,
        description: tier.description || undefined,
        price,
        priceCurrency: 'USD',
        url: canonical('/pricing'),
        ...(free
          ? {}
          : {
              priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price,
                priceCurrency: 'USD',
                unitText: seat ? 'per seat per month' : 'per month',
              },
            }),
      },
    ]
  })

/** The landing page's graph: the publisher, the site, the product with its
 * prices, and the questions the page answers. */
export const landingGraph = ({
  tiers,
  faq,
}: {
  tiers: MarketingTier[]
  faq: readonly Faq[]
}) => {
  const priced = offers(tiers)
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organization(),
      {
        '@type': 'WebSite',
        '@id': `${siteUrl()}/#website`,
        name: 'SessClone',
        url: siteUrl(),
        description: SITE_DESCRIPTION,
        publisher: { '@id': organizationId() },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'SessClone',
        url: siteUrl(),
        description: SITE_DESCRIPTION,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Linux, Windows',
        license: 'https://www.gnu.org/licenses/agpl-3.0.html',
        publisher: { '@id': organizationId() },
        sameAs: [REPOSITORY],
        ...(priced.length > 0 ? { offers: priced } : {}),
      },
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((entry) => ({
          '@type': 'Question',
          name: entry.question,
          acceptedAnswer: { '@type': 'Answer', text: entry.answer },
        })),
      },
    ],
  }
}

/** A docs page's graph: where it sits under Docs, and what it is. */
export const docsGraph = (page: {
  url: string
  title: string
  description?: string
}) => {
  const url = canonical(page.url)
  const isIndex = page.url === '/docs'
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Docs',
            item: canonical('/docs'),
          },
          ...(isIndex
            ? []
            : [
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: page.title,
                  item: url,
                },
              ]),
        ],
      },
      {
        '@type': 'TechArticle',
        headline: page.title,
        description: page.description,
        url,
        mainEntityOfPage: url,
        inLanguage: 'en',
        isPartOf: { '@id': `${siteUrl()}/#website` },
        publisher: organization(),
      },
    ],
  }
}

/**
 * JSON for a `<script type="application/ld+json">`. `<` is escaped so no
 * string in the graph (a Tier description an admin typed) can close the
 * script element early.
 */
export const jsonLd = (graph: unknown) =>
  JSON.stringify(graph).replace(/</g, '\\u003c')
