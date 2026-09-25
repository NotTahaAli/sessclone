import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// The Proxy's two redirects, which are each other's mirror: a signed-out
// visitor is sent to the sign-in page, and — the half that was missing until
// Taha reported it on 2026-09-22 — a signed-in one is sent away from it.
//
// Supabase is stubbed because the question is the routing rather than the JWT.
// `claims` is what the real client returns from `getClaims()`, and the only
// thing this file does with it is decide whether somebody is signed in.

let claims: { sub: string } | null = null
// What `getClaims()` rotates, when set: the real client writes a refreshed
// session through the `setAll` it was handed.
let rotated: { name: string; value: string }[] = []

type SetAll = (
  cookies: { name: string; value: string; options: object }[],
) => void

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: SetAll } },
  ) => ({
    auth: {
      getClaims: async () => {
        if (rotated.length > 0) {
          options.cookies.setAll(
            rotated.map((cookie) => ({ ...cookie, options: { path: '/' } })),
          )
        }
        return { data: claims ? { claims } : null }
      },
    },
  }),
}))

const { proxy } = await import('../proxy')

beforeEach(() => {
  claims = null
  rotated = []
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  // The whole public site, as sessclone.com runs it; ticket 138's tests
  // below switch parts of it off.
  vi.stubEnv('ENABLE_LANDING', 'true')
  vi.stubEnv('ENABLE_DOCS', 'true')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const at = (path: string) =>
  proxy(new NextRequest(`https://sessclone.example.com${path}`))

test('a signed-out visitor is sent to the sign-in page', async () => {
  const response = await at('/costs')

  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe(
    'https://sessclone.example.com/sign-in',
  )
})

test('a signed-in person is sent off the sign-in and sign-up pages', async () => {
  claims = { sub: 'user-1' }

  const responses = await Promise.all(
    ['/sign-in', '/sign-up?plan=team&seats=3'].map(at),
  )

  for (const response of responses) {
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://sessclone.example.com/costs',
    )
  }
})

test('an invitation followed while signed in lands on the invitation', async () => {
  claims = { sub: 'user-1' }

  const response = await at('/sign-in?next=%2Fjoin%2Ftoken-1')

  expect(response.headers.get('location')).toBe(
    'https://sessclone.example.com/join/token-1',
  )
})

test('a `next` keeps its own query string', async () => {
  claims = { sub: 'user-1' }

  const response = await at('/sign-in?next=%2Fcosts%3Fview%3Dprojects')

  expect(response.headers.get('location')).toBe(
    'https://sessclone.example.com/costs?view=projects',
  )
})

test('a `next` that leaves the origin is not redirected to', async () => {
  claims = { sub: 'user-1' }

  // `//evil.example` is an absolute URL to a browser, which is why `safeNext`
  // exists and why this goes to Costs instead.
  const response = await at('/sign-in?next=%2F%2Fevil.example')

  expect(response.headers.get('location')).toBe(
    'https://sessclone.example.com/costs',
  )
})

test('the marketing page renders for a signed-out visitor', async () => {
  expect((await at('/')).status).toBe(200)
})

test('pages and files read before an account are public', async () => {
  // Signed out throughout: none of these may redirect to the sign-in page, or
  // crawlers index `/sign-in` and share cards come up blank.
  const paths = [
    '/sign-up',
    '/pricing',
    '/privacy',
    '/terms',
    '/docs',
    '/docs/self-hosting',
    '/api/search?q=install',
    '/robots.txt',
    '/sitemap.xml',
    '/favicon.ico',
    '/icon.svg',
    '/icon0.png',
    '/apple-icon.png',
    '/opengraph-image',
    '/opengraph-image.png',
    '/twitter-image-abc123',
    '/manifest.webmanifest',
    '/llms.txt',
    '/.well-known/security.txt',
  ]
  const statuses = await Promise.all(
    paths.map(async (path) => ({ path, status: (await at(path)).status })),
  )
  expect(statuses).toEqual(paths.map((path) => ({ path, status: 200 })))
})

test('a lookalike of a public file is not public', async () => {
  const paths = [
    '/robots.txt.bak',
    '/icons/costs',
    '/llms.txt/x',
    '/.well-known/other.txt',
  ]
  const statuses = await Promise.all(
    paths.map(async (path) => (await at(path)).status),
  )
  expect(statuses).toEqual([307, 307, 307, 307])
})

// Ticket 137: the demo has no session, so the Proxy lets its cookie through
// when the deployment runs the demo — and only then.
const withCookie = (path: string, cookie: string) =>
  proxy(
    new NextRequest(`https://sessclone.example.com${path}`, {
      headers: { cookie },
    }),
  )

test('/demo is public, and the demo cookie reaches the dashboard only with ENABLE_DEMO=true', async () => {
  vi.stubEnv('ENABLE_DEMO', 'true')
  expect((await at('/demo')).headers.get('location')).toBeNull()
  expect(
    (await withCookie('/costs', 'sessclone-demo=1')).headers.get('location'),
  ).toBeNull()
  // Any other value is no demo at all.
  expect(
    (await withCookie('/costs', 'sessclone-demo=yes')).headers.get('location'),
  ).toBe('https://sessclone.example.com/sign-in')

  vi.stubEnv('ENABLE_DEMO', 'false')
  expect(
    (await withCookie('/costs', 'sessclone-demo=1')).headers.get('location'),
  ).toBe('https://sessclone.example.com/sign-in')
})

// Ticket 138: the three site flags. The decisions are `lib/site-flags.ts`'s,
// tested there case by case; these prove the Proxy applies them.
const visit = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://sessclone.example.com${path}`, { headers }))

test('with landing off, / goes to sign-in or, signed in, to the dashboard', async () => {
  vi.stubEnv('ENABLE_LANDING', 'false')
  expect((await at('/')).headers.get('location')).toBe('/sign-in')

  claims = { sub: 'user-1' }
  // Even from a page of the site: there is no landing page to read.
  const response = await visit('/', { 'sec-fetch-site': 'same-origin' })
  expect(response.headers.get('location')).toBe('/costs')
})

test('with landing on, a signed-in direct visit to / opens the dashboard', async () => {
  claims = { sub: 'user-1' }

  const direct: Record<string, string>[] = [{ 'sec-fetch-site': 'none' }, {}]
  const locations = await Promise.all(
    direct.map(async (headers) =>
      (await visit('/', headers)).headers.get('location'),
    ),
  )
  expect(locations).toEqual(['/costs', '/costs'])
  // The dashboard's logo is a link on this origin: no bounce.
  const logo = await visit('/', { 'sec-fetch-site': 'same-origin' })
  expect(logo.status).toBe(200)
  expect(logo.headers.get('location')).toBeNull()
})

test('the demo visitor counts as signed in only where the demo runs', async () => {
  vi.stubEnv('ENABLE_DEMO', 'true')
  const demo = { cookie: 'sessclone-demo=1', 'sec-fetch-site': 'none' }
  expect((await visit('/', demo)).headers.get('location')).toBe('/costs')
  // Never for sign-in and sign-up: the demo banner's "Sign up" must work.
  expect((await visit('/sign-up', demo)).headers.get('location')).toBeNull()

  vi.stubEnv('ENABLE_DEMO', 'false')
  expect((await visit('/', demo)).status).toBe(200)
})

test('pricing 404s with landing off, docs and their search with docs off', async () => {
  vi.stubEnv('ENABLE_LANDING', 'false')
  vi.stubEnv('ENABLE_DOCS', 'false')
  claims = { sub: 'user-1' }
  const paths = ['/pricing', '/docs', '/docs/self-hosting', '/api/search?q=x']
  const statuses = await Promise.all(
    paths.map(async (path) => (await at(path)).status),
  )
  expect(statuses).toEqual([404, 404, 404, 404])

  // The legal pages stay, and so does everything else signed-out.
  claims = null
  const kept = ['/privacy', '/terms', '/sign-in', '/sign-up']
  const keptStatuses = await Promise.all(
    kept.map(async (path) => (await at(path)).status),
  )
  expect(keptStatuses).toEqual([200, 200, 200, 200])
})

test('a flag 404 holds on a deployment with Supabase unconfigured', async () => {
  vi.stubEnv('ENABLE_DOCS', 'false')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  expect((await at('/docs')).status).toBe(404)
})

// The review of ticket 138 (2026-09-25).

test('the / redirect keeps the session cookies getClaims rotated', async () => {
  claims = { sub: 'user-1' }
  rotated = [{ name: 'sb-example-auth-token', value: 'fresh' }]

  const response = await visit('/', { 'sec-fetch-site': 'none' })
  expect(response.headers.get('location')).toBe('/costs')
  expect(response.headers.get('set-cookie')).toMatch(
    /^sb-example-auth-token=fresh;/,
  )
})

test('the / redirect is never cached: it depends on the session', async () => {
  claims = { sub: 'user-1' }
  const signedIn = await visit('/', { 'sec-fetch-site': 'none' })
  expect(signedIn.headers.get('cache-control')).toBe('private, no-store')

  vi.stubEnv('ENABLE_LANDING', 'false')
  claims = null
  const signedOut = await at('/')
  expect(signedOut.headers.get('location')).toBe('/sign-in')
  expect(signedOut.headers.get('cache-control')).toBe('private, no-store')
})

test('a sign-in code that lands on / goes on to the callback, query and all', async () => {
  // Supabase falls back to the Site URL when a redirect is not allow-listed.
  for (const landing of ['true', 'false']) {
    vi.stubEnv('ENABLE_LANDING', landing)
    // oxlint-disable-next-line no-await-in-loop -- one flag at a time.
    const response = await at('/?code=abc-123&next=%2Fjoin%2Ft')
    expect(response.headers.get('location'), landing).toBe(
      '/auth/callback?code=abc-123&next=%2Fjoin%2Ft',
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  }
})

test('behind a proxy, the Referer is compared with NEXT_PUBLIC_APP_URL', async () => {
  // `next start` behind a reverse proxy sees its own host, not the browser's.
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://sessclone.com')
  claims = { sub: 'user-1' }
  const behind = (referer: string) =>
    proxy(new NextRequest('http://localhost:3000/', { headers: { referer } }))

  expect((await behind('https://sessclone.com/costs')).status).toBe(200)
  // And the redirect is relative, so the browser stays on its own host
  // rather than being sent to the server's `localhost`.
  expect(
    (await behind('http://localhost:3000/costs')).headers.get('location'),
  ).toBe('/costs')
})
