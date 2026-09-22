# 67: Self-hosting

**What to build:** Someone who would rather not pay can run the whole thing themselves, against their own database and their own bucket.

**Blocked by:** 15, 32, 66.

**Status:** done

- [x] Every external dependency configured by environment variable, nothing hard-coded
- [x] A compose file bringing the application up against a supplied database and bucket
- [x] Storage works against more than one S3-compatible provider, proven with at least two
- [x] Documentation from clone to first collected Turn
- [x] Licence obligations stated where a self-hoster will see them

## What landed

- **Nothing hard-coded, and a test that keeps it that way.**
  `packages/shared/src/configuration.test.ts` now fails when a provider's
  hostname — `supabase.co`, `cloudflarestorage.com`, `amazonaws.com`, `r2.dev`,
  `anthropic.com` — appears in a non-comment line of `apps/web/app`,
  `apps/web/lib` or either package's source. Verified red by giving
  `STORAGE_ENDPOINT` a fallback to an R2 URL. The Collector's
  `http://127.0.0.1:3000` default is deliberately allowed: a documented
  fallback for an unset variable is the opposite of a compiled-in dependency.
- **`Dockerfile` and `compose.yaml`.** Two stages, pinned bases
  (`node:22.23.2-trixie-slim`, `postgres:16.15-alpine3.24`, both looked up
  rather than recalled), non-root, and the public variables as build arguments
  because the browser bundle reads them at build time. Compose runs the
  application against a supplied database and bucket, with Postgres available
  under a `db` profile and a named volume. It deliberately stands up neither
  storage nor authentication: both hold data that must outlive a container.
- **`apps/web/scripts/storage-compat.mjs`** — the narrow, specific parts of
  the S3 API this product actually needs, checked against whatever endpoint it
  is handed: a presigned PUT with no checksum in the signature, a body with an
  exact `content-length`, `HeadObject`, a presigned GET carrying
  `response-content-disposition`, `DeleteObjects` with its per-key failures,
  and a confirmed absence afterwards.
- **`docs/self-hosting.md`** — clone to first Turn, in order, including the
  two roles and why pointing both variables at one of them switches row-level
  security off silently, the GitHub **OAuth App** (not GitHub App) that
  Supabase sign-in needs, unpriced Turns, and the retention warning that
  matters before a first sweep.
- **Licence obligations where a self-hoster sees them**: the panel notice they
  must keep, what AGPL section 13 does and does not ask of them (it arises
  only when they modify the software and let others use it over a network),
  and that a private fork is permitted indefinitely — "send it back as a pull
  request" is a hope, not a condition. `NOTICE.md` is linked and still says
  plainly that no lawyer has reviewed it.

## Proven, and not proven

`storage-compat.mjs` passes end to end against **two independent S3
implementations** — moto (Python, 5.2.x) and s3rver (Node) — both started
locally, both exercising the real signer and real HTTP:

```
http://127.0.0.1:5050 · bucket sessclone-compat     (moto)
  ok    presign a PUT with no checksum in the signature — no checksum parameter
  ok    upload the bytes through that URL
  ok    read the size back with HeadObject — 51 bytes
  ok    download with a filename and the right bytes — attachment; filename="session.jsonl"
  ok    delete it, and report per-key failures
  ok    a deleted object is gone — answers 404
```

with the same six lines against `http://127.0.0.1:5070` (s3rver).

**Not proven here, and stated rather than claimed:** Cloudflare R2, AWS S3 and
Supabase Storage need credentials this environment does not have, and
`compose.yaml` has been validated by `docker compose config` but never
built — there is no Docker daemon in this container. Both belong to the manual
verification tickets (68, 69), and the compose file should be built once on a
machine that can before anybody is told to rely on it.
