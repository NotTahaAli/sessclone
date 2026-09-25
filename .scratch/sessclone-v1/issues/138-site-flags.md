# 138: Site flags for the landing page, the docs and the demo

**What to build:** Taha, 2026-09-25: a self-hosted copy serves the dashboard alone, and sessclone.com switches on the public site. Three flags decide which parts a deployment serves.

**What was picked (Taha's decisions, 2026-09-25, final).**

1. **Three flags**, `ENABLE_LANDING`, `ENABLE_DOCS`, `ENABLE_DEMO`, each `true` or `false`. `ENABLE_DEMO` replaces ticket 137's `DEMO=on` everywhere.
2. **Unset means off.** A self-hoster gets only the dashboard; sessclone.com sets all three to `true`.
3. **Landing off:** `/` goes to sign-in, or to the dashboard when signed in. `/pricing` returns 404 (the landing page includes pricing, so one flag gates both); `/privacy` and `/terms` stay. Sign-up keeps its plan step. The sitemap, robots, `llms.txt` and the landing page's JSON-LD point at nothing that 404s.
4. **Docs off:** `/docs` and `/api/search` return 404, and every docs link points at the same path on https://sessclone.com/docs.
5. **Signed in, a direct visit to `/` opens the dashboard.** The dashboard's logo links to the landing page without bouncing; with landing off it opens the dashboard home. The landing header shows Dashboard in place of Sign in when signed in.
6. **Tested as a matrix:** the eight flag combinations × signed out, signed in and the demo visitor, with the decisions in one pure module.

**Decided while building (stated, not asked).**

- **No bounce from the logo:** the Proxy redirects a signed-in `/` only when the request did not come from this origin, read from Fetch Metadata's `Sec-Fetch-Site` (`same-origin` is a click on this site; `none` is a typed address or bookmark; `cross-site` a link elsewhere), falling back to the Referer's origin where a browser sends no `Sec-Fetch-Site`. Decided in the Proxy before any render, so nothing flashes, and the URL stays `/`. A `?from=app` marker was rejected: every in-site link to `/` would need it, and a copied URL would carry it.
- **The demo visitor** counts as signed in for `/` and for the landing header only where `ENABLE_DEMO=true`, the rule `sessionUser` already applies; never for the sign-in and sign-up redirect, so the demo banner's Sign up still works.
- **404s live in the Proxy**, which reads the flags per request and rewrites to a path no route matches, so the app's not-found page renders. The pages read the flags while they prerender, so **changing a flag needs a rebuild and redeploy**; `Dockerfile` and `compose.yaml` pass the three as build arguments.
- **Exit demo** leaves for `/` with landing on and `/sign-in` with it off.

**Review fixes (2026-09-25).** The `/` redirect keeps the session cookies `getClaims` rotated and is sent `Cache-Control: private, no-store`; a `/?code=…` that Supabase sent to its Site URL goes on to `/auth/callback` with the query kept (self-hosting now says to allow-list `/auth/callback`); the Referer fallback compares with `NEXT_PUBLIC_APP_URL`'s origin, so it holds behind a reverse proxy; the header's Sign in / Dashboard button streams in behind a same-width placeholder instead of flashing "Sign in"; the logo is not prefetched; the sitemap and `llms.txt` wait for a request (`connection()`, since `dynamic` is refused under `cacheComponents`), so they follow the runtime flags. Second round: the `/` redirects send a relative Location, so behind a reverse proxy the browser is never sent to the server's own `localhost`; "Try the demo" is not in the prerendered shell, so a signed-in reader never sees it before the session read.

**Merge prerequisite.** Before deploying, set `ENABLE_LANDING`, `ENABLE_DOCS` and `ENABLE_DEMO` to `true` on Vercel for Production and Preview, and remove `DEMO`. Unset, sessclone.com would serve the dashboard alone.

**Blocked by:** 137

**Status:** done

- [x] `lib/site-flags.ts`: flag parsing, which paths are served, where `/` goes, the logo, Pricing and Docs links, and the sitemap's paths; `test/site-flags.test.ts` table-drives all eight combinations.
- [x] The Proxy applies the 404s and the `/` redirect (`test/proxy.test.ts`); the sitemap and `llms.txt` list only what is served (`test/site-indexes.test.ts`); Exit demo (`test/demo.test.ts`).
- [x] The marketing header and footer drop Pricing without landing and link hosted docs without docs; the dashboard's logo is a link at both widths and on the waiting page.
- [x] `docs/configuration.md`, the configuration and self-hosting docs pages, `docs/self-hosting.md`, `.env.example` and the CHANGELOG; `DEMO` renamed to `ENABLE_DEMO` throughout.
- [x] Landing header signed in and signed out, and the dashboard with landing off, at 1440x900 and 390x844 in light and dark.
- [x] Render tests for the marketing header and footer, the dashboard logo and "Try the demo" (`test/site-flags-render.test.tsx`).
- [x] Playwright: a typed `/` opens Costs, and the dashboard logo reaches the landing page and stays there, reload included (`e2e/site-flags.e2e.ts`).
- [x] "Try the demo" is hidden from a signed-in visitor, whose real session wins over the demo cookie (Taha, 2026-09-25); `test/site-flags-render.test.tsx`.
