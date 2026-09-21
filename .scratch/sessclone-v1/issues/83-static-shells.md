# 83: Static shells for the signed-in routes

**What to build:** Cache Components is on for the whole app (ticket 80), and every route but the two marketing ones opts out of static shell validation with `export const instant = false`. That was a deferral to get ticket 80 landed, not a design: the dashboard's chrome — the sidebar, the bottom bar, the frame the Org name sits in — is exactly what a prerendered shell is for, and today those routes prerender a zero-byte shell instead.

Reaching a real shell means moving each request-data read (the session, the route's params, `searchParams`) behind a `<Suspense>` boundary so the frame renders around it, then removing the opt-out. The opt-out is inherited by every new page under `(dashboard)` and `admin`, so this gets quieter to fix the sooner it is done.

**Blocked by:** 80.

**Status:** ready-for-agent

- [ ] `(dashboard)` and `admin` prerender a real shell — chrome, not an empty file
- [ ] `/sign-in` and `/join/[token]` do the same, or state in the file why they cannot
- [ ] No route carries `instant = false` afterwards, or each one that does names its reason
- [ ] A test or a build assertion fails if a shell goes back to zero bytes
