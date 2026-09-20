# Frontend architecture

The choices every page in `apps/web` then follows: where a component runs,
what gets cached, what draws the charts, where the tests go, and which packages
this adds to the workspace. The read path itself is ADR 0007, and the colours,
components and chart palette are `docs/design/design-system.md`; this file is
the rest of ticket 20.

> **Almost none of this exists yet.** `apps/web` today is a layout, a page that
> renders the word `sessclone`, and the probe route from ticket 02. There is no
> Tailwind dependency, no `globals.css`, no Supabase client and no `proxy.ts`.
> Every section below names what it adds and which ticket first needs it —
> reading this file as a description of the tree will not go well.

Every library claim here was checked against the current documentation or the
published package at the time of writing, and is cited where it is made. Every
version was looked up from the registry on 2026-09-20. Nothing here is from
memory, and a claim that has drifted is a claim to re-check rather than to
trust.

## Server and client boundaries

Pages and layouts are Server Components, and they are where data is fetched.
A page calls the connection function from ADR 0007, gets rows back, and hands
those rows down as props. No page fetches from the browser, and no component
below a page opens its own connection.

`'use client'` sits on the leaf and nowhere above it. The boundary is a module
boundary, not a subtree: marking a layout turns every page under it into client
code, and the rows would then have to travel as JSON to a bundle that renders
them, which is the shape this avoids.

| Client module | Why it has to be one |
| --- | --- |
| Each chart | One module per chart, taking its rows as props. Recharts measures and draws in the DOM. |
| The date-range control | It is state the user changes, and it drives the query string the page reads. |
| The theme toggle | It writes `data-theme` on `<html>`, which the design system's `dark` variant reads. |

Everything else — the shell, the nav, the figures, the tables under the charts
— stays on the server. A table of Turns is markup and numbers; it has no reason
to ship.

### recharts has no directive of its own

`recharts` 3.10.1 ships no `"use client"` directive anywhere in the package.
Verified by unpacking the published tarball and searching it: zero files in
`lib/`, `es6/`, `umd/` or `types/` contain the string, and its `package.json`
declares `"sideEffects": false` with `main: lib/index.js` and
`module: es6/index.js`.

So recharts cannot be imported from a Server Component. Every import of it goes
through a module in `apps/web` that carries `'use client'` at the top, and that
module is the chart. This is not a workaround to be removed later — it is the
same rule as the table above, stated for the one dependency where forgetting it
is a build error rather than a design mistake.

## Caching

No `cacheComponents` flag in `next.config`, and none of the caching vocabulary
that flag unlocks: no `'use cache'`, no `cacheLife`, no `cacheTag`.

The reason is structural rather than a preference. Every read in the dashboard
is scoped by Role, so every read needs the session cookie, so none of it is
cacheable in the first place. Next's own error text is explicit: reading
`cookies()` inside a `"use cache"` function throws, because "it would make the
cache invalidated by every request", and the documented fix is to move the
dynamic call outside and pass the value in as an argument.\* Doing that here
would mean keying a cache on the viewer's identity — a per-Member cache of
per-Member data, which is a cache that never hits twice.

\* `next-request-in-use-cache`, and the same throw in
`packages/next/src/server/request/cookies.ts`, both consulted 2026-09-20 via
Context7 against `vercel/next.js`.

So the flag would buy the dashboard nothing, and it would cost everyone a
vocabulary: a second set of rules about what may be called where, learned by
every person and every agent that touches a page, in exchange for no cache
hits.

**What changes that.** A public marketing surface living in this app. Marketing
pages read no session, so they are the first thing here that could genuinely be
cached, and they are the point at which this decision is re-opened rather than
worked around. Until then the answer to "should this be cached" is that it
cannot be.

## Charting

`recharts`, pinned at 3.10.1.

| Package | Version | Deprecated |
| --- | --- | --- |
| `recharts` | 3.10.1 | no |

Looked up with `pnpm view recharts version` and `pnpm view recharts deprecated`
on 2026-09-20; the latter returns nothing, which is what a healthy package
returns. This matches spec §13, but it matches it because it was checked, not
because it was copied.

### Colours are passed per element

Every drawn element takes its colour as an explicit prop reading a token:
`fill="var(--color-series-1)"`, `stroke="var(--color-series-2)"`, and so on for
the six slots the design system defines. No component reads a hex, and no
palette lives in JavaScript.

This is not a stylistic preference over recharts' theme support — it is what
that support can actually carry. A theme does exist at the pinned version:
`recharts` 3.10.1 exports `RechartsThemeProvider`, `lightTheme`, `darkTheme`
and `legacyTheme` from its index, and a `useRechartsTheme` hook from
`theme/RechartsThemeContext`. But the `RechartsTheme` interface in
`types/theme/RechartsTheme.d.ts` has exactly one member:

```ts
export interface RechartsTheme {
    grid: Partial<{
        stroke: string;
        strokeOpacity: number;
        strokeWidth: number;
        strokeDasharray: string | number | ReadonlyArray<number>;
        fillOpacity: number;
        fill: string;
    }>;
}
```

and `lightTheme` is `{ grid: { stroke: '#d6d3d1', fill: 'none' } }`. It themes
the cartesian grid and nothing else — it carries no series colours, no axis
colours and no text colours — and every one of those declarations is annotated
`@experimental`, with `RechartsTheme` itself warning that the API will change
in a minor or patch version. So a theme object could at most replace the grid
stroke, at the price of pinning a surface the library says is unstable. It is
not used.

Passing per element keeps the design system's own promise intact: "Recharts
draws it and does not decide it", and "the palette reaches it as an array of
CSS variables, so nothing here is library-specific." A chart then takes the
viewer's theme for free, because the tokens already do.

### Charts take a title

Every chart component takes a `title` prop and renders it, and passes it to the
chart root as the SVG `title`, which recharts declares as a prop on the
cartesian chart props and renders onto the root surface. A chart without a
title is an unlabelled figure; ChartFrame in the design system lists Title as
one of its parts, and this is that part.

### The accessibility layer is on by default

`recharts` 3 turns `accessibilityLayer` on unless told otherwise, and that has
a consequence worth a deliberate look. In the published package,
`types/chart/CartesianChart.d.ts` declares `defaultCartesianChartProps` with
`readonly accessibilityLayer: true` — matched by `accessibilityLayer: true` in
`es6/chart/CartesianChart.js` — and `PieChart`, `RadarChart`, `RadialBarChart`,
`PolarChart` and `Sankey` declare the same default. `es6/container/RootSurface.js`
then does:

```js
role = hasAccessibilityLayer ? 'application' : undefined;
```

alongside `tabIndex = hasAccessibilityLayer ? 0 : undefined`. So every chart
ships as a focusable `role="application"` region by default.

`role="application"` hands keystrokes to the widget rather than to the screen
reader, which is a strong claim for a figure to make. Whether that reads better
or worse than the alternative is an empirical question, and it belongs to the
accessibility pass rather than to this file — flagged here so the pass finds it
rather than discovering it.

What is settled is the non-visual path, and it is not the chart. The design
system already requires a table under every chart, carrying every row where the
chart shows five and an Other, with every value from the hover readout in it:
"The table under the chart carries every row, and that table is part of the
chart, not an extra." That table is server-rendered markup. It is what a screen
reader, a touch device and a screenshot all get, and it does not depend on how
the `application` question is resolved.

## Testing

This ticket adds no test infrastructure. Nothing is installed, no config file
is added, and `apps/web/vitest.config.mts` is unchanged. The three levels the
repo already runs are the three levels these surfaces are covered at.

| What | Where | Why there |
| --- | --- | --- |
| Aggregation, bucketing, formatting | `packages/shared` | Pure functions over Turns and Cost. Fast Node tests already run there — `turns.test.ts`, `identity.test.ts` and the rest — and they need no browser and no database. |
| Routes and policies | `apps/web` | Against a real Postgres with the real migrations, as `apps/web/vitest.config.mts` already sets up. A chart query is an RLS question, and this is where RLS questions are answered. |
| Rendered surfaces | Playwright screenshots | The repo already requires a page to be run in Chromium at 1440×900 and 390×844, in both themes, and the screenshots looked at. That is the pass that covers what a chart looks like. |

The first row is where the work goes. A bucketing bug is cheapest to catch as a
pure function, so bucketing is a pure function in `packages/shared` and the
page calls it — not a helper defined beside the page where only a browser test
could reach it.

**Server Components are not unit-tested, and that is Next's own position, not
ours.** The Next.js testing guide says: "Since `async` Server Components are
new to the React ecosystem, some tools do not fully support them. In the
meantime, we recommend using **End-to-End Testing** over **Unit Testing** for
`async` components." The Vitest page repeats it for the runner this repo uses —
"Vitest currently does not support them ... we recommend using **E2E tests** for
`async` components" — and the Jest and Cypress pages say the same.\*

\* `docs/01-app/02-guides/testing/index.mdx`, `.../vitest.mdx`, `.../jest.mdx`
and `.../cypress.mdx`, consulted 2026-09-20 via Context7 against
`vercel/next.js`.

That rules out the test that would otherwise be reached for first, and it is
why the split above pushes logic out of the page rather than trying to test the
page. A page whose only job is to fetch rows and hand them to a chart has
nothing left that a unit test would have caught.

## What this ticket adds to the workspace

Five packages, in three groups, plus two files.

### Versions

All five looked up from the registry on 2026-09-20 with `pnpm view <pkg>
version`, and checked with `pnpm view <pkg> deprecated`, which returned nothing
for every one of them — **none is deprecated**. This environment is node
v22.22.2 and pnpm 10.33.0.

| Package | Version | Deprecated | For |
| --- | --- | --- | --- |
| `tailwindcss` | 4.3.3 | no | The design system's `@theme` block |
| `@tailwindcss/postcss` | 4.3.3 | no | The PostCSS plugin Tailwind 4 needs |
| `recharts` | 3.10.1 | no | Charts |
| `@supabase/supabase-js` | 2.116.0 | no | The Supabase client |
| `@supabase/ssr` | 0.12.7 | no | Cookie-based sessions across server and browser |

**Versions are pinned in the catalog.** `pnpm-workspace.yaml` carries a
`catalog:` block — "One place to pin every shared version. Looked up from the
registry, never recalled" — and every package in `apps/web/package.json` is
declared as `"catalog:"` rather than as a range. These five are added the same
way: the exact version in the catalog, `catalog:` in the dependency list. A
version written directly into a `package.json` in this workspace is a mistake
to fix, not a shortcut.

### Styling

`tailwindcss` and `@tailwindcss/postcss`, the PostCSS config they need, and
`apps/web/app/globals.css` — which is the file `docs/design/design-system.md`
already specifies, down to the `@custom-variant dark` block that follows both
the system preference and a forced `data-theme`, and the `@theme static` block
that holds the fixed half of the palette. This ticket adds the dependency and
the file; the design system decides the contents, and disagreements between the
two are resolved in the design system's favour.

The derived half — the five accent tokens computed from a Member's seed — is
written onto `<html>` as inline custom properties at render time, and is ticket
77's to feed.

### Supabase client modules

`@supabase/supabase-js` and `@supabase/ssr`, as two small modules: a browser
client and a server client. Both are configuration, not logic. Their three
environment variables are already the contract in `docs/configuration.md`, and
`SUPABASE_SERVICE_ROLE_KEY` is not read by either of them — ADR 0001 confines
it to ingest, and these are the modules the browser can reach.

`@supabase/ssr`'s server client takes `getAll` and `setAll` cookie handlers and
initialises the session lazily: the package's own source documents that "the
session is not loaded until the first call to `getSession()`, `getUser()`, or
`getClaims()`", and that "token refreshes write the updated session back to
cookies via the `setAll` handler."\*

Which of those three to call matters. `@supabase/ssr`'s own tests state it
plainly: "`getSession()` reads directly from the cookie — no network call" while
"`getUser()` always contacts the auth server to verify the token".\* A claim
that will be set on a database connection and relied on by a policy is not a
claim to take unverified from a cookie, so the verified form is the one used.

\* `src/createServerClient.ts`, `src/createServerClient.spec.ts` and
`src/types.ts` in `supabase/ssr`, consulted 2026-09-20 via Context7.

### Session refresh — `proxy.ts`, not `middleware.ts`

The session-refresh file is `apps/web/proxy.ts`, exporting a function named
`proxy`.

**Next 16 renamed it, and a file in the old place silently never runs.** The
version 16 upgrade guide says to "rename the middleware file to proxy.ts or
proxy.js", and to "replace the deprecated named export `middleware` with
`proxy`", giving `export function proxy(request: Request) {}`. The file
convention reference adds that "Proxy defaults to using the Node.js runtime",
that the `runtime` config option "is not available in Proxy files", and that
setting it "will throw an error". Supabase's own Next.js example has already
moved: its `proxy.ts` exports `async function proxy(request: NextRequest)`,
calls `updateSession(request)`, and carries a `config.matcher` excluding
`_next/static`, `_next/image`, `favicon.ico` and image files.\*

\* `docs/01-app/02-guides/upgrading/version-16.mdx`,
`docs/01-app/03-api-reference/03-file-conventions/proxy.mdx` and
`examples/with-supabase/proxy.ts` in `vercel/next.js`, consulted 2026-09-20 via
Context7.

The Node-only runtime is the part that suits this repo: the refresh runs where
`@supabase/ssr` and the `postgres` driver already run, with no edge-runtime
subset to work around.

This file refreshes the session cookie and nothing else. It is not where
authorisation happens — ADR 0001 put that in row-level security, and a
redirect in a proxy is a convenience for the person, never the thing that keeps
an Org's rows apart.
