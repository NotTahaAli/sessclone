// Response headers a security scan (web-check.xyz, 2026-10-03) found missing.
// The fixed ones go out from `next.config.ts` on every path, assets included;
// the Content-Security-Policy is built per request in the Proxy, because it
// names the storage endpoint, which a self-hosted image only learns at run
// time (the Dockerfile passes no storage variables to the build).

/** Same on every response. No Cross-Origin-Embedder-Policy: `require-corp`
 * would block the transcript preview's CDN scripts and fonts, which send no
 * CORP header. HSTS has no `preload`: leaving the preload list takes months,
 * so that is Taha's call, not a default. */
export const FIXED_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

/** Files another origin legitimately loads, which keep CORP `cross-origin`:
 * Clarity's replays render the page's CSS, fonts and images from
 * clarity.microsoft.com, the invitation email embeds the Org logo, and a link
 * preview may hot-link the share image or icons. */
export const CROSS_ORIGIN_PATHS = [
  '/_next/static/:path*',
  '/api/org-logo/:path*',
  '/opengraph-image',
  '/icon.svg',
  '/apple-icon.png',
  '/favicon.ico',
]

/** Where presigned storage URLs point, or null when the endpoint is unset or
 * not a URL. With path-style addressing off (`lib/storage.ts`), the SDK puts
 * the bucket in the host (`<bucket>.<endpoint host>`), so any subdomain. */
const storageSources = (env: {
  STORAGE_ENDPOINT?: string
  STORAGE_FORCE_PATH_STYLE?: string
}) => {
  const url = env.STORAGE_ENDPOINT
  if (!url || !URL.canParse(url)) return null
  const { origin, protocol, host } = new URL(url)
  return env.STORAGE_FORCE_PATH_STYLE === 'false'
    ? `${origin} ${protocol}//*.${host}`
    : origin
}

/**
 * The page policy. Scripts and styles allow `'unsafe-inline'` because the
 * pages prerender: a nonce would make every page render per request and lose
 * its cached shell (ticket 83). What it still buys: no framing, no plugins, no
 * `<base>` hijack, and fetches only to this origin, storage and analytics.
 *
 * The transcript's artifact preview is a sandboxed `srcdoc` frame, which
 * inherits this policy on top of its own (`transcript/artifacts.ts`), so its
 * CDNs and Google Fonts are listed here too.
 *
 * No `form-action`: Chrome applies it to the redirects after a submit, and
 * the GitHub sign-in without JavaScript is a POST that redirects to Supabase
 * and then GitHub. No `upgrade-insecure-requests` either: a self-hosted
 * deployment on plain HTTP would lose every asset, and HSTS covers this site.
 */
export const contentSecurityPolicy = (env: {
  STORAGE_ENDPOINT?: string
  STORAGE_FORCE_PATH_STYLE?: string
  NODE_ENV?: string
}) => {
  const storage = storageSources(env)
  const dev = env.NODE_ENV === 'development'
  const clarity = 'https://*.clarity.ms https://c.bing.com'
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} https://static.cloudflareinsights.com ${clarity} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${clarity}`,
    `connect-src 'self'${storage ? ` ${storage}` : ''} https://cloudflareinsights.com ${clarity}${dev ? ' ws:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
