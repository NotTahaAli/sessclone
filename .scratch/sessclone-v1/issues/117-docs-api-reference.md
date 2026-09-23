# 117: API reference with Fumadocs OpenAPI

**What to build:** Taha, 2026-09-23: future APIs for transcript access and MCP; picked Fumadocs native over Scalar for an exact theme match.

**Where the ask forks, and what was picked (Taha's picks).**

- An OpenAPI 3.1 spec for ingest, generated from its zod schema so it cannot drift. fumadocs-openapi renders it; its playground is added as source via the Fumadocs CLI and styled with our primitives.
- Responses as the route really answers: 200, 400, 401, 503.

**Blocked by:** 116.

**Status:** done

- [x] Spec generated from zod, with a test that fails on drift
- [x] API pages and playground themed
- [x] Screenshots

Screenshots (1440x900 and 390x844, light and dark): scratchpad `shots-116/api-*, tryit-*`.
