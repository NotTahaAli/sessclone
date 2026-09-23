// Cloudflare Web Analytics, on the public pages (marketing and docs): it is
// cookieless and stores nothing on the device, so it needs no consent. Not on
// the dashboard, whose URLs carry search text and ids. Nothing loads until a deployment
// sets its site token. Snippet from
// https://developers.cloudflare.com/web-analytics/faq/ (2026-09-23); it
// reports client-side route changes by itself.
export function CloudflareAnalytics() {
  const token = process.env.NEXT_PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN
  if (!token) return null
  return (
    <script
      type="module"
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token })}
    />
  )
}
