# 83: Static shells for the signed-in routes

**What to build:** Cache Components is on for the whole app (ticket 80), and every route but the two marketing ones opts out of static shell validation with `export const instant = false`. That was a deferral to get ticket 80 landed, not a design: the dashboard's chrome — the sidebar, the bottom bar, the frame the Org name sits in — is exactly what a prerendered shell is for, and today those routes prerender a zero-byte shell instead.

Reaching a real shell means moving each request-data read (the session, the route's params, `searchParams`) behind a `<Suspense>` boundary so the frame renders around it, then removing the opt-out. The opt-out is inherited by every new page under `(dashboard)` and `admin`, so this gets quieter to fix the sooner it is done.

**Blocked by:** 80.

**Status:** done

- [x] `(dashboard)` and `admin` prerender a real shell — chrome, not an empty file
- [x] `/sign-in` and `/join/[token]` do the same, or state in the file why they cannot
- [x] No route carries `instant = false` afterwards, or each one that does names its reason
- [x] A test or a build assertion fails if a shell goes back to zero bytes

**How it landed:** `(dashboard)/layout.tsx` is a static frame with the Org name, the account menu and the page body each behind their own `<Suspense>`; `/sign-in` keeps the heading and both forms in the shell and streams the query string in. `/costs`, `/devices`, `/keys` and every `/settings` route now prerender a 5,929-byte shell (was zero) and `/sign-in` 2,272 bytes.

`admin` and `/join/[token]` keep an empty shell on purpose and say so in the file: `admin`'s gate is the secret (a frame saying "sessclone · Platform" ahead of a 404 confirms the area exists), and the join page's whole content _is_ the session read. Both keep `instant = false`, which per Next's own docs only silences instant-navigation validation — the empty shell comes from the structure, and the comments say that rather than crediting the flag.

`scripts/check-shells.mjs` runs in CI after the DB-less `next build`: it fails when a listed shell is missing or empty, and when one contains a fixture address or the account menu, which would be a viewer's data in a page served to everybody.
