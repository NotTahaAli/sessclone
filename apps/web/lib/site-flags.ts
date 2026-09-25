// Ticket 138: which parts of the public site this deployment serves.
//
// Taha's decisions (2026-09-25, final): three switches, `ENABLE_LANDING`,
// `ENABLE_DOCS` and `ENABLE_DEMO`, each `true` or `false`, and unset means
// off. A self-hosted copy is the dashboard alone; sessclone.com sets all
// three. Only `true` turns one on (trimmed, any case): `on`, `1` and typos
// are off, so a mistake shows the smaller site rather than the larger one.
//
// Everything decided from the flags lives here, pure, so one table-driven
// test covers it (`test/site-flags.test.ts`). The Proxy applies the 404s and
// redirects per request; the pages read the links while they prerender, so a
// change to a flag needs a rebuild (`docs/configuration.md`).

export type SiteFlags = { landing: boolean; docs: boolean; demo: boolean }

type Env = Record<string, string | undefined>

const on = (value: string | undefined) => value?.trim().toLowerCase() === 'true'

/** The three flags, read per call so a test can flip them. */
export const siteFlags = (env: Env = process.env): SiteFlags => ({
  landing: on(env.ENABLE_LANDING),
  docs: on(env.ENABLE_DOCS),
  demo: on(env.ENABLE_DEMO),
})

/** The path or anything under it, by whole segments. */
const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`)

/**
 * Whether this deployment serves `path` at all; false is a 404.
 *
 * Landing gates `/pricing` (the landing page includes pricing) and docs gates
 * `/docs` and its search. `/` is never a 404, it redirects (`homeRedirect`),
 * and the legal pages are always served. `/demo` answers for itself.
 */
export const servesPath = (flags: SiteFlags, path: string) => {
  if (under(path, '/pricing')) return flags.landing
  if (under(path, '/docs') || under(path, '/api/search')) return flags.docs
  return true
}

/**
 * The hosted docs, where every docs link points when this deployment serves
 * none. Fixed rather than configurable: the docs describe the upstream
 * product, and sessclone.com is where they are always published.
 */
export const HOSTED_SITE = 'https://sessclone.com'

/** The links the flags decide, for the headers, footers and indexes. */
export const siteLinks = (flags: SiteFlags) => ({
  /** The dashboard's logo: the landing page, or with none the dashboard. */
  logo: flags.landing
    ? { href: '/', label: 'SessClone home page' }
    : { href: DASHBOARD_HOME, label: 'Dashboard home' },
  /** The Pricing link, or null where there is no pricing page. */
  pricing: flags.landing ? '/pricing' : null,
  /** A docs page, here or on sessclone.com: the same path either way. */
  docs: (path = '/docs') => (flags.docs ? path : `${HOSTED_SITE}${path}`),
})

/**
 * What the sitemap lists: the pages this deployment serves to a signed-out
 * visitor, and nothing that 404s or redirects. The legal pages always; the
 * landing page and pricing with landing; the docs with docs. Never `/demo`.
 */
export const sitemapPaths = (flags: SiteFlags, docsPages: string[]) => [
  ...(flags.landing ? ['/', '/pricing'] : []),
  '/privacy',
  '/terms',
  ...(flags.docs ? docsPages : []),
]

/** Where the dashboard starts, and where a signed-in `/` goes. */
export const DASHBOARD_HOME = '/costs'

/**
 * Who is asking, for the redirect from `/`. A real session is signed in; the
 * demo cookie counts only where the demo runs (the same rule `sessionUser`
 * applies), so a stale cookie on a deployment without one is nobody.
 */
export type Visit = {
  session: boolean
  demoCookie: boolean
  /** Followed from a page of this site (`fromSite`). */
  fromSite: boolean
}

/**
 * Where a visit to `/` is sent, or null to render the landing page.
 *
 * With landing off `/` is never the landing page: the dashboard, or sign-in.
 * With it on, a signed-in person who typed the address (or followed a link
 * from elsewhere) gets the dashboard, and one who followed a link on this
 * site, the dashboard's logo above all, reads the landing page, so arriving
 * there does not bounce.
 */
export const homeRedirect = (flags: SiteFlags, visit: Visit): string | null => {
  const signedIn = visit.session || (flags.demo && visit.demoCookie)
  if (!flags.landing) return signedIn ? DASHBOARD_HOME : '/sign-in'
  return signedIn && !visit.fromSite ? DASHBOARD_HOME : null
}

/**
 * Where a sign-in code that arrived on `/` belongs: the callback, with the
 * query string whole. Supabase sends a sign-in to its Site URL, the bare
 * origin, when the `redirectTo` it was given is not on the project's Redirect
 * URLs list, and `/` would otherwise drop the code (and, with landing off,
 * bounce to sign-in). null for anything else.
 */
export const callbackRedirect = (path: string, query: URLSearchParams) =>
  path === '/' && query.get('code') ? `/auth/callback?${query}` : null

/**
 * Whether a request was a link followed from a page of this origin.
 *
 * Fetch Metadata's `Sec-Fetch-Site`, which the browser sets and a page cannot
 * (a forbidden header): `same-origin` for a click or a client-side navigation
 * here, `none` for a typed address or a bookmark, `cross-site` for a link
 * elsewhere. Browsers too old to send it fall back to the Referer's origin,
 * which the default `strict-origin-when-cross-origin` policy keeps whole for
 * same-origin requests. Neither is a security check: the worst a wrong answer
 * does is show the landing page, or skip it.
 */
export const fromSite = (headers: Headers, origin: string) => {
  const site = headers.get('sec-fetch-site')
  if (site) return site === 'same-origin'
  const referer = headers.get('referer')
  if (!referer || !URL.canParse(referer)) return false
  return new URL(referer).origin === origin
}
