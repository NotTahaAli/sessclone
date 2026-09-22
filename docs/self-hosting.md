# Self-hosting sessclone

Everything this product needs is yours to supply: a Postgres cluster, an
S3-compatible bucket, and a Supabase project for sign-in. Nothing is
hard-coded and nothing phones home — `packages/shared/src/configuration.test.ts`
fails the build if a provider's hostname ever appears in application code.

This page goes from a clone to the first collected Turn. `docs/configuration.md`
is the reference for every variable; this is the order to do them in.

## What you need first

| Thing                   | Why                                                                        |
| ----------------------- | -------------------------------------------------------------------------- |
| Postgres 16 or newer    | Every table, and the policies that are the authorisation (ADR 0001)        |
| An S3-compatible bucket | Transcripts, which never pass through the application (ADR 0003)           |
| A Supabase project      | Sign-in only. Hosted or self-hosted; the migrations touch no `auth` schema |
| Node 22.18+ and pnpm    | To build, and on each Member's machine for the Collector                   |

Storage is optional to start with: with `STORAGE_*` unset, archival is off and
everything else works. A deployment with no bucket collects Turns, prices them
and shows them, and stores no transcripts at all.

## 1. Clone, and write the environment

```bash
git clone https://github.com/NotTahaAli/sessclone
cd sessclone
pnpm install
cp .env.example apps/web/.env     # apps/web/.env, not the repo root
```

Fill it in. The two database URLs are deliberately two roles, and pointing
both at the same one switches row-level security off for the whole application
with no error anywhere to say so — `supabase/README.md` is the long version.

## 2. Create the roles and apply the migrations

```bash
psql "$ADMIN_URL" -c "create role sessclone login password 'choose-one'"
psql "$ADMIN_URL" -c "create database sessclone owner sessclone"
# The migrations create sessclone_app themselves, without a password: a
# migration has no business inventing a credential. Give it one.
for file in supabase/migrations/*.sql; do
  psql "postgres://sessclone:choose-one@your-host:5432/sessclone" -f "$file"
done
psql "$ADMIN_URL" -c "alter role sessclone_app login password 'choose-another'"
```

`alter role`, never `create role`: the migration already created it, and a
`create role` attempt fails with "already exists" in a way that looks harmless.

Then point `DATABASE_URL` at `sessclone_app` and `INGEST_DATABASE_URL` at
`sessclone`. `apps/web/app-role.test.ts` fails if the dashboard is ever
pointed at a privileged role.

## 3. Check your bucket actually works

"S3-compatible" covers a wide range, and this product uses a narrow and
specific part of the API: a presigned PUT with no checksum in the signature, a
streamed body with an exact `content-length`, `HeadObject`, a presigned GET
carrying `response-content-disposition`, and `DeleteObjects` — whose per-key
failures arrive inside a 200. One script answers whether yours does all of it:

```bash
STORAGE_ENDPOINT=… STORAGE_BUCKET=… \
STORAGE_ACCESS_KEY_ID=… STORAGE_SECRET_ACCESS_KEY=… \
node apps/web/scripts/storage-compat.mjs
```

It writes and deletes one object under `storage-compat/`, prints a line per
check and exits non-zero on the first failure. Run it before you tell anybody
archival is on.

## 4. Run it

```bash
docker compose up --build            # your database
docker compose --profile db up --build   # or bring one up alongside
```

`compose.yaml` runs the application and, under the `db` profile, a Postgres
with a named volume. It deliberately does **not** stand up storage or
authentication: both hold data that must outlive a container, and a compose
file that quietly created a bucket would be a compose file that quietly lost
the transcripts in it.

Without Docker, the same thing by hand:

```bash
pnpm --filter web build
pnpm --filter web start
```

The `NEXT_PUBLIC_*` variables are read by the browser bundle at build time, so
changing one means rebuilding rather than restarting.

## 5. Sign in, and collect the first Turn

1. Open the deployment and sign in. Supabase GitHub sign-in needs a GitHub
   **OAuth App**, not a GitHub App — a GitHub App fails with `Error getting
user profile from external provider`, because Supabase asks for the
   `user:email` scope a GitHub App ignores.
2. The first person to sign in gets an Org and is its Owner.
3. Issue a key under **Keys**.
4. Install the Collector on a machine: `docs/install.md`, which is two
   commands, the key, and a restart of Claude Code.
5. Run a Claude Code session. The Turn appears under **Costs** as soon as the
   session's first response finishes.

If nothing arrives, `docs/install.md` § "Checking it worked" has the list in
the order worth checking, and the Collector's own session-start message names
the common causes. Nothing about a failed report is silent on the machine and
invisible in the dashboard: **Costs → Failures** shows what the Collector
recorded.

## Rates, so the costs are not zero

A Turn with no Rate that matches its model is _unpriced_, never zero — the
total always carries the count of unpriced Turns beside it. Seed the published
prices under **/admin → Rates** (the platform admin flag is set on the `users`
row), or accept unpriced Turns and read token counts only.

## Retention, so transcripts do not accumulate forever

Retention is a window per Org, and nothing enforces it on a schedule because
your scheduler is yours. `docs/configuration.md` § "Retention sweep" has the
call and the warning that matters: on a deployment that has been collecting
for a while, set the windows **before** the first sweep, because the column
arrives defaulted to 90 days and the first sweep acts on it.

## What the licence asks of you

sessclone is AGPL-3.0-only with one additional term under section 7(b), and
`NOTICE.md` states both. In practice, for a deployment:

- **Offering source to your users.** AGPL section 13 applies when you modify
  the software and let others use it over a network. Unmodified, it does not
  arise; modified, your users may ask you for the source of your version.
- **The panel notice stays.** The additional term preserves the notice at the
  bottom of the dashboard — copyright, no warranty, the statement that you may
  convey this work under this licence, the link to it, and the sessclone
  credit. Restyle it; do not remove it.
- **Self-hosting is free at any size, and a private fork is permitted
  indefinitely.** Sending changes back as a pull request is something we hope
  for and cannot require, and no licence here does.

`NOTICE.md` also says plainly that no lawyer has reviewed any of this.
