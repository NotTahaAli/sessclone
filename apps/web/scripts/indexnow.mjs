// Tells Bing, Yandex and the other IndexNow engines (https://www.indexnow.org)
// that the public pages changed, so they recrawl now rather than whenever
// they next get round to it. Google does not take IndexNow; Search Console
// is the way there.
//
// Run it after a deploy that changes public pages, against the live site:
//
//   node apps/web/scripts/indexnow.mjs              # sessclone.com
//   node apps/web/scripts/indexnow.mjs https://…    # another deployment
//
// It reads the URLs from the deployment's own sitemap, so it submits exactly
// what the deployment says it serves. The key is public by design: IndexNow
// proves ownership by fetching `public/<key>.txt` from the same host, which a
// third party cannot place there.

import { pathToFileURL } from 'node:url'

/** Must match the name and contents of `public/<key>.txt`. */
const KEY = 'c2fe2a1ee4ef303216f53c7df18f4b3d'

/** The `<loc>` entries of a sitemap. */
export const sitemapUrls = (xml) =>
  [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1])

/** The IndexNow request body for these URLs on `site`. */
export const submission = (site, urls, key = KEY) => {
  const { host, origin } = new URL(site)
  return {
    host,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList: urls.filter((url) => new URL(url).host === host),
  }
}

const main = async () => {
  const site = (process.argv[2] ?? 'https://sessclone.com').replace(/\/+$/, '')
  const sitemap = await fetch(`${site}/sitemap.xml`)
  if (!sitemap.ok) throw new Error(`sitemap: HTTP ${sitemap.status}`)
  const body = submission(site, sitemapUrls(await sitemap.text()))
  // A sitemap on another host (www against the apex, or a deployment whose
  // NEXT_PUBLIC_APP_URL differs from the address given) leaves nothing to
  // submit, and IndexNow refuses an empty list with a less helpful message.
  if (body.urlList.length === 0) {
    throw new Error(`no sitemap URLs on ${body.host}; check the address`)
  }
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  // 200 accepted, 202 accepted with the key still being checked; anything
  // else is a refusal worth reading.
  console.log(
    `IndexNow: HTTP ${response.status} for ${body.urlList.length} URLs`,
  )
  if (response.status !== 200 && response.status !== 202) {
    console.log(await response.text())
    process.exitCode = 1
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
