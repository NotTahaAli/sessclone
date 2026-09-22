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

## Acted on after review

An independent review read the whole slice and reproduced five failures that a
self-hoster following this page would hit before the application ever started.
Every one of them is fixed here, and each was reproduced first rather than
taken on trust.

- **`docker compose up` could not start, whichever path you took.**
  `POSTGRES_PASSWORD` carried a `:?` requirement, and compose interpolates
  every service's variables whether or not that service's profile is active —
  so a deployment bringing its own database was refused a start over a
  password for a Postgres it never asked for. Reproduced with
  `docker compose config`: `required variable POSTGRES_PASSWORD is missing a
value`. It now has an empty default, and the Postgres image itself refuses
  to initialise without one, which is the error at the right moment.
- **The environment file was documented in the wrong place for Docker.**
  `compose.yaml` reads the `.env` beside it; the page said `apps/web/.env`,
  which Next reads and compose does not. Both are now named, with which is
  which, in `.env.example`, `compose.yaml` and step 1.
- **The documented migration order could not complete.** `sessclone` is
  created as a plain login role, and `20260920120200_app_role.sql` runs
  `create role sessclone_app`, which needs `createrole`. Reproduced:
  `permission denied to create role`. It worked locally only because the
  development role is a superuser. Both roles are now created before the
  migrations, which the migration's own existence guard is written for.
- **The migration loop reported success on a half-migrated database.** `psql`
  exits 0 after a failed statement, so the loop walked all 28 files and left
  the operator to find out later. It now runs with `ON_ERROR_STOP=1`,
  `--single-transaction` and `|| exit 1`.
- **No `.dockerignore`, with `COPY . .` in the Dockerfile.** The host's
  `node_modules` (host-platform binaries), `.git`, `.next`, `.scratch` and —
  after step 1 — a live `apps/web/.env` were all copied into an image layer.
  Added.
- **The runtime image reached the npm registry on every container start.** The
  run stage enabled corepack and the entrypoint was `pnpm --filter web start`;
  corepack materialises pnpm by downloading it, so an air-gapped host got a
  container that never served and `restart: unless-stopped` turned that into a
  silent crash loop. The entrypoint is `next` directly, and corepack is gone
  from the final stage.

Seven more, each verified before it was believed:

- Postgres was published on every interface; it is now bound to loopback.
- `PORT` named both the host mapping and the port `next start` listens on, so
  setting it moved the server and published the old port. Renamed `WEB_PORT`,
  and documented in `docs/configuration.md` along with the other two compose
  variables.
- The `db` profile had no usable path: the host is `db` inside the network and
  not `127.0.0.1`, the database already exists, and nothing waited for it. The
  page now has that block, and `web` has an optional `depends_on` on the
  healthcheck that was defined and unused.
- "Seed the published prices" sent an operator to the admin panel for
  something `20260921090000_rate_seed.sql` already does — 82 Rates and 5
  Tiers on a fresh database. And the platform admin flag it told them to set
  is guarded by a trigger that fires for the owning role too, so the obvious
  `update users set is_platform_admin = true` fails. Reproduced, and the page
  now carries the incantation that works.
- "The first person to sign in gets an Org" implied a one-time bootstrap.
  `lib/auth/bootstrap.ts` runs for everybody with no membership, so on a
  deployment with open sign-ups every stranger gets an Org. Said plainly, with
  the fix being Supabase's sign-up settings.
- `storage-compat.mjs` continued after a failure, so one broken presign
  printed five cascaded failures that hid it, and it accepted a 403 from
  `HeadObject` as proof that a delete had taken — the one false pass a
  compatibility script must not give. It now stops at the first failure, and
  says it cannot tell rather than passing on a 403. Re-verified against both
  implementations, and the fail-fast path was seen firing on a wrong
  credential.
- The hard-coded-host test scanned neither `apps/web/proxy.ts` (the session
  path, and the likeliest place for a hostname) nor `next.config.ts` nor
  `apps/web/scripts`, and its host list was missing six object stores and this
  project's own domains. Widened, all still clean. It also spawned `git` at
  module import, which a release tarball or a Docker build context has none of
  — and which would have taken the other configuration contract tests down
  with it. It now falls back to walking the directories, verified by running
  the file with `git` replaced by a shim that exits 1.
