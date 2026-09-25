import { NextRequest } from 'next/server'
import { beforeEach, expect, test, vi } from 'vitest'

// The Proxy's two redirects, which are each other's mirror: a signed-out
// visitor is sent to the sign-in page, and — the half that was missing until
// Taha reported it on 2026-09-22 — a signed-in one is sent away from it.
//
// Supabase is stubbed because the question is the routing rather than the JWT.
// `claims` is what the real client returns from `getClaims()`, and the only
// thing this file does with it is decide whether somebody is signed in.

let claims: { sub: string } | null = null

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: claims ? { claims } : null }) },
  }),
}))

const { proxy } = await import('../proxy')

beforeEach(() => {
  claims = null
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
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

test('the marketing page is left alone either way', async () => {
  expect((await at('/')).status).toBe(200)

  claims = { sub: 'user-1' }
  // Signed in, `/` still renders: the call to action on it changes instead,
  // which is `app/(marketing)/signed-in-link.tsx`.
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

test('/demo is public, and the demo cookie reaches the dashboard only with DEMO=on', async () => {
  vi.stubEnv('DEMO', 'on')
  try {
    expect((await at('/demo')).headers.get('location')).toBeNull()
    expect(
      (await withCookie('/costs', 'sessclone-demo=1')).headers.get('location'),
    ).toBeNull()
    // Any other value is no demo at all.
    expect(
      (await withCookie('/costs', 'sessclone-demo=yes')).headers.get(
        'location',
      ),
    ).toBe('https://sessclone.example.com/sign-in')

    vi.stubEnv('DEMO', 'off')
    expect(
      (await withCookie('/costs', 'sessclone-demo=1')).headers.get('location'),
    ).toBe('https://sessclone.example.com/sign-in')
  } finally {
    vi.unstubAllEnvs()
  }
})
