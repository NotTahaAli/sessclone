import { describe, expect, it } from 'vitest'

import {
  fromSite,
  homeRedirect,
  servesPath,
  siteFlags,
  siteLinks,
  sitemapPaths,
  type SiteFlags,
} from '../lib/site-flags'

/** All eight combinations, named `LDM` with a dash for off: `L-M` is landing
 * and demo on, docs off. */
const COMBOS = ['---', 'L--', '-D-', '--M', 'LD-', 'L-M', '-DM', 'LDM'] as const
type Combo = (typeof COMBOS)[number]
const flagsOf = (combo: Combo): SiteFlags => ({
  landing: combo[0] === 'L',
  docs: combo[1] === 'D',
  demo: combo[2] === 'M',
})

// Ticket 138: the three switches, and the decisions made from them. Pure, so
// every case is a row here; the Proxy and the pages only read the answers.

describe('siteFlags', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['true', true],
    [' TRUE ', true],
    ['True', true],
    ['false', false],
    // Only `true` opts in: the old demo spelling and near-misses stay off.
    ['on', false],
    ['1', false],
    ['yes', false],
  ])('%j reads as %s', (value, expected) => {
    const env = {
      ENABLE_LANDING: value,
      ENABLE_DOCS: value,
      ENABLE_DEMO: value,
    }
    expect(siteFlags(env)).toEqual({
      landing: expected,
      docs: expected,
      demo: expected,
    })
  })

  it('reads each flag on its own', () => {
    expect(siteFlags({ ENABLE_DOCS: 'true' })).toEqual({
      landing: false,
      docs: true,
      demo: false,
    })
  })

  it('is all off with nothing set: a self-hoster gets the dashboard alone', () => {
    expect(siteFlags({})).toEqual({ landing: false, docs: false, demo: false })
  })
})

describe('servesPath', () => {
  const ALL = COMBOS
  const LANDING = ['L--', 'LD-', 'L-M', 'LDM']
  const DOCS = ['-D-', 'LD-', '-DM', 'LDM']

  // Which combinations serve each path; every other combination 404s it.
  const TABLE: [string, readonly string[]][] = [
    // The landing page includes pricing, so one flag gates both.
    ['/pricing', LANDING],
    ['/pricing/', LANDING],
    ['/docs', DOCS],
    ['/docs/self-hosting', DOCS],
    ['/docs/api/ingest', DOCS],
    // The docs search is the docs.
    ['/api/search', DOCS],
    // `/` is never a 404: with landing off it redirects (`homeRedirect`).
    ['/', ALL],
    // The legal pages stay whatever the flags: sign-up and the dashboard's
    // Legal notices link to them.
    ['/privacy', ALL],
    ['/terms', ALL],
    // The demo's own route answers for itself (`app/demo/route.ts`).
    ['/demo', ALL],
    ['/sign-in', ALL],
    ['/sign-up', ALL],
    ['/costs', ALL],
    ['/api/ingest', ALL],
    ['/sitemap.xml', ALL],
    ['/robots.txt', ALL],
    ['/llms.txt', ALL],
    // Prefixes are whole segments: a lookalike is not the gated page.
    ['/pricingx', ALL],
    ['/docsx', ALL],
    ['/api/searching', ALL],
  ]

  it.each(TABLE)('%s', (path, serving) => {
    const got = COMBOS.filter((combo) => servesPath(flagsOf(combo), path))
    expect(got).toEqual(COMBOS.filter((combo) => serving.includes(combo)))
  })
})

// The three visitors of the matrix: nobody, a real Supabase session, and a
// browser holding the demo cookie with no session.
const VISITORS = {
  out: { session: false, demoCookie: false },
  in: { session: true, demoCookie: false },
  demo: { session: false, demoCookie: true },
} as const
type Visitor = keyof typeof VISITORS

describe('homeRedirect', () => {
  // Where a visit to `/` goes: typed or followed from another site (direct),
  // and followed from a page of this one (from the site). null renders the
  // landing page.
  const TABLE: [Combo, Visitor, string | null, string | null][] = [
    // Landing off: `/` is never the landing page.
    ['---', 'out', '/sign-in', '/sign-in'],
    ['---', 'in', '/costs', '/costs'],
    ['---', 'demo', '/sign-in', '/sign-in'],
    ['-D-', 'out', '/sign-in', '/sign-in'],
    ['-D-', 'in', '/costs', '/costs'],
    ['-D-', 'demo', '/sign-in', '/sign-in'],
    ['--M', 'out', '/sign-in', '/sign-in'],
    ['--M', 'in', '/costs', '/costs'],
    ['--M', 'demo', '/costs', '/costs'],
    ['-DM', 'out', '/sign-in', '/sign-in'],
    ['-DM', 'in', '/costs', '/costs'],
    ['-DM', 'demo', '/costs', '/costs'],
    // Landing on: signed in, a direct visit opens the dashboard and a click
    // from the site (the dashboard's logo) reads the landing page.
    ['L--', 'out', null, null],
    ['L--', 'in', '/costs', null],
    ['L--', 'demo', null, null],
    ['LD-', 'out', null, null],
    ['LD-', 'in', '/costs', null],
    ['LD-', 'demo', null, null],
    ['L-M', 'out', null, null],
    ['L-M', 'in', '/costs', null],
    ['L-M', 'demo', '/costs', null],
    ['LDM', 'out', null, null],
    ['LDM', 'in', '/costs', null],
    ['LDM', 'demo', '/costs', null],
  ]

  it('covers every combination and visitor', () => {
    expect(new Set(TABLE.map(([c, v]) => `${c} ${v}`)).size).toBe(24)
  })

  it.each(TABLE)(
    '%s %s: direct %s, from the site %s',
    (combo, who, direct, site) => {
      const flags = flagsOf(combo)
      const visitor = VISITORS[who]
      expect(homeRedirect(flags, { ...visitor, fromSite: false })).toBe(direct)
      expect(homeRedirect(flags, { ...visitor, fromSite: true })).toBe(site)
    },
  )
})

describe('links', () => {
  const HOSTED = 'https://sessclone.com/docs'
  // Per combination: the dashboard logo, the header and footer's Pricing
  // (null is no link), the Docs link, and a docs page's link.
  const TABLE: [Combo, string, string | null, string, string][] = [
    ['---', '/costs', null, HOSTED, `${HOSTED}/self-hosting`],
    ['L--', '/', '/pricing', HOSTED, `${HOSTED}/self-hosting`],
    ['-D-', '/costs', null, '/docs', '/docs/self-hosting'],
    ['--M', '/costs', null, HOSTED, `${HOSTED}/self-hosting`],
    ['LD-', '/', '/pricing', '/docs', '/docs/self-hosting'],
    ['L-M', '/', '/pricing', HOSTED, `${HOSTED}/self-hosting`],
    ['-DM', '/costs', null, '/docs', '/docs/self-hosting'],
    ['LDM', '/', '/pricing', '/docs', '/docs/self-hosting'],
  ]

  it.each(TABLE)(
    '%s: logo %s, pricing %s, docs %s',
    (combo, logo, pricing, docs, page) => {
      const links = siteLinks(flagsOf(combo))
      expect(links.logo.href).toBe(logo)
      expect(links.pricing).toBe(pricing)
      expect(links.docs()).toBe(docs)
      expect(links.docs('/docs/self-hosting')).toBe(page)
    },
  )

  it('names where the logo goes', () => {
    expect(siteLinks(flagsOf('L--')).logo.label).toBe('SessClone home page')
    expect(siteLinks(flagsOf('---')).logo.label).toBe('Dashboard home')
  })
})

describe('sitemapPaths', () => {
  const DOCS = ['/docs', '/docs/self-hosting']
  const TABLE: [Combo, string[]][] = [
    ['---', ['/privacy', '/terms']],
    ['L--', ['/', '/pricing', '/privacy', '/terms']],
    ['-D-', ['/privacy', '/terms', ...DOCS]],
    ['--M', ['/privacy', '/terms']],
    ['LD-', ['/', '/pricing', '/privacy', '/terms', ...DOCS]],
    ['L-M', ['/', '/pricing', '/privacy', '/terms']],
    ['-DM', ['/privacy', '/terms', ...DOCS]],
    // The demo is never listed: it is a made-up dashboard behind a cookie.
    ['LDM', ['/', '/pricing', '/privacy', '/terms', ...DOCS]],
  ]

  it.each(TABLE)('%s', (combo, paths) => {
    const flags = flagsOf(combo)
    expect(sitemapPaths(flags, DOCS)).toEqual(paths)
    // Nothing listed is a page this deployment 404s or redirects away from.
    for (const path of sitemapPaths(flags, DOCS)) {
      expect(servesPath(flags, path), path).toBe(true)
      if (path === '/') {
        const visit = { session: false, demoCookie: false, fromSite: false }
        expect(homeRedirect(flags, visit)).toBeNull()
      }
    }
  })
})

describe('fromSite', () => {
  const ORIGIN = 'https://sessclone.com'
  it.each([
    // Fetch Metadata, which every current browser sends on a navigation.
    [{ 'sec-fetch-site': 'same-origin' }, true],
    [{ 'sec-fetch-site': 'none' }, false], // typed, bookmarked
    [{ 'sec-fetch-site': 'cross-site' }, false], // a link elsewhere
    [{ 'sec-fetch-site': 'same-site' }, false], // another subdomain
    // It wins over the Referer, which a page can shape.
    [{ 'sec-fetch-site': 'none', referer: `${ORIGIN}/costs` }, false],
    // A browser without it: the Referer's origin decides.
    [{ referer: `${ORIGIN}/costs` }, true],
    [{ referer: 'https://sessclone.com.evil.example/' }, false],
    [{ referer: 'not a url' }, false],
    [{}, false],
  ])('%j → %s', (init, expected) => {
    expect(fromSite(new Headers(init), ORIGIN)).toBe(expected)
  })
})
