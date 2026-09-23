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
 * Whether search engines may crawl this deployment: `SEARCH_INDEXING=on`.
 * Off by default, so a self-hosted copy stays out of search results unless
 * its operator opts in; the hosted service sets it in production.
 */
export const searchIndexing = () => process.env.SEARCH_INDEXING === 'on'

/** This deployment's host name, for prose ("the service at …"). */
export const siteHost = () => new URL(siteUrl()).host

/**
 * Where visitors write to the operator: `NEXT_PUBLIC_CONTACT_EMAIL`. Null when
 * unset, and every contact link is hidden then, so a self-hosted copy never
 * sends its visitors to somebody else's inbox.
 */
export const contactEmail = () => process.env.NEXT_PUBLIC_CONTACT_EMAIL || null

export const SITE_DESCRIPTION =
  'Claude Code usage and cost for a whole team: laptops, cloud sessions and CI in one priced ledger. Open source, free to self-host.'

/** The absolute link for a public page, for canonical links and indexes. */
export const canonical = (path: string) =>
  `${siteUrl()}${path === '/' ? '' : path}`

/** The public marketing pages: the sitemap lists them, and Clarity runs only
 * on them (`app/(marketing)/clarity.tsx`). */
export const MARKETING_PATHS = ['/', '/pricing', '/privacy', '/terms'] as const
