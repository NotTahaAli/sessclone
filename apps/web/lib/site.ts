/**
 * Where this deployment answers, for the metadata files (Open Graph image
 * URLs, robots, the sitemap). Unlike `appUrl` it never throws: a build with
 * no `NEXT_PUBLIC_APP_URL` still has to emit a robots file, and one that
 * blocks everything is the right answer there.
 */
export const siteUrl = () =>
  (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  )

/**
 * The one origin search engines should list. Every other deployment of this
 * code (a self-hosted copy, `sessclone.vercel.app`, a preview) serves the same
 * marketing pages, so they point their canonical links here and their robots
 * file keeps crawlers out: duplicates would compete with the real site.
 */
export const CANONICAL_ORIGIN = 'https://sessclone.com'

export const isCanonicalSite = () => siteUrl() === CANONICAL_ORIGIN

export const SITE_DESCRIPTION =
  'Claude Code usage and cost for a whole team: laptops, cloud sessions and CI in one priced ledger. Open source, free to self-host.'

/** The canonical link for a public page, always on `CANONICAL_ORIGIN`. */
export const canonical = (path: string) =>
  `${CANONICAL_ORIGIN}${path === '/' ? '' : path}`

/** The public marketing pages: the sitemap lists them, and Clarity runs only
 * on them (`app/(marketing)/clarity.tsx`). */
export const MARKETING_PATHS = ['/', '/pricing', '/privacy', '/terms'] as const
