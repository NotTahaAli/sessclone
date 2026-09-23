# Self-hosting sessclone

Everything this product needs is yours to supply: a Postgres cluster, an
S3-compatible bucket, and a Supabase project for sign-in. Nothing is
hard-coded and nothing phones home — `packages/shared/src/configuration.test.ts`
fails CI if a provider's hostname ever appears in application code.

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
cp .env.example apps/web/.env     # running it directly
cp .env.example .env              # running it with Docker Compose
```

Two destinations, and they are not interchangeable. `next dev` and `next start`
read `apps/web/.env`, because Next reads environment files from its own project
root; `compose.yaml` reads the `.env` beside it. Doing both means the same
values in both files, and `.env.example` says which variables belong to which.

Fill it in. The two database URLs are deliberately two roles, and pointing
both at the same one switches row-level security off for the whole application
with no error anywhere to say so — `supabase/README.md` is the long version.

## 2. Create the roles and apply the migrations

`$ADMIN_URL` below is a connection as a role that may create roles and
databases — on a fresh cluster that is `postgres`, and on a managed one it is
whatever superuser-equivalent your provider gave you.

**Both roles are created before the migrations run.** The migration that
creates `sessclone_app` guards on its existence and skips it if it is already
there, which is the path to take: creating a role from inside the migrations
needs `createrole`, and `sessclone` deliberately has neither that nor
superuser — a plain login role gets `permission denied to create role` part way
through `20260920120200_app_role.sql`.

```bash
ADMIN_URL="postgres://postgres:…@your-host:5432/postgres"

psql "$ADMIN_URL" -c "create role sessclone login password 'choose-one'"
psql "$ADMIN_URL" -c "create database sessclone owner sessclone"
# nologin is wrong here: this is the role the dashboard connects as.
psql "$ADMIN_URL" -c "create role sessclone_app login password 'choose-another'"

OWNER_URL="postgres://sessclone:choose-one@your-host:5432/sessclone"
for file in supabase/migrations/*.sql; do
  echo "$file"
  psql -v ON_ERROR_STOP=1 --single-transaction "$OWNER_URL" -f "$file" || exit 1
done
```

`ON_ERROR_STOP=1` is not optional. Without it `psql` exits 0 after a failed
statement, so the loop walks the whole directory and leaves you with a
half-migrated database that reports success. `--single-transaction` means a
file that fails leaves nothing of itself behind.

On an existing deployment, do not re-run the loop: the migrations use bare
`create table` and there is no applied-migration ledger yet, so a second run
errors on the first file. Apply only the files added since your last upgrade,
in filename order, and read the header of each one first — the retention
warning below is an example of an upgrade that acts on data.

Then point `DATABASE_URL` at `sessclone_app` and `INGEST_DATABASE_URL` at
`sessclone`. `apps/web/app-role.test.ts` fails if the dashboard is ever
pointed at a privileged role.

**An upgrade is two steps, and the order matters.** Nothing in the deploy
applies a migration, so a release whose code reads a new column against a
database that has not got it yet serves a broken page for every surface that
reads it — and leaves the rest working, which is what makes it read as
several unrelated bugs. Apply the new migrations first, deploy second, and
check the two agree:

```bash
DATABASE_URL="$OWNER_URL" node apps/web/scripts/schema-drift.mjs
```

A few migrations must run **after** the deploy instead, because the code still
live beforehand depends on what they remove. Their header says so, and they
are the exception: hold them back from the batch above, deploy, then apply
them. `20260923140000_artifact_kind_drop_old_key.sql` is one — run before the
deploy, it fails every archival upload until the new code is live.

It names every migration the checkout has and the database does not, and
exits non-zero when there are any. It reads
`supabase_migrations.schema_migrations`, which only the Supabase CLI and the
Management API write: applying the files with the `psql` loop above leaves no
ledger, and the script says so and stops rather than calling every migration
missing.

## 3. Check your bucket actually works

"S3-compatible" covers a wide range, and this product uses a narrow and
specific part of the API: a presigned PUT with no checksum in the signature,
`HeadObject`, a presigned GET
carrying `response-content-disposition`, and `DeleteObjects` — whose per-key
failures arrive inside a 200. One script answers whether yours does all of it:

```bash
STORAGE_ENDPOINT=… STORAGE_BUCKET=… \
STORAGE_ACCESS_KEY_ID=… STORAGE_SECRET_ACCESS_KEY=… \
node apps/web/scripts/storage-compat.mjs
```

It writes and deletes one object under `storage-compat/`, prints a line per
check and stops at the first failure with a non-zero exit, so the line above
the exit is the thing to fix. Run it before you tell anybody
archival is on.

The bucket must also answer CORS for the dashboard: the transcript viewer
reads byte ranges straight from storage in the browser, through presigned GET
URLs, so allow `GET` with the `Range` request header from your dashboard's
origin. Supabase Storage allows this by default (`access-control-allow-origin:
*`, `range` among the allowed headers); on R2, AWS or MinIO add a CORS rule.

## 4. Run it

```bash
docker compose up --build                # your database
docker compose --profile db up --build   # or bring one up alongside
```

If you used the `db` profile, three things differ. The database is reachable
from the web container as the host `db` rather than `127.0.0.1`, so both
database URLs in the root `.env` name `db:5432`. The database itself already
exists and is already owned by `sessclone`, so skip the `create database` line
in step 2 — and set `POSTGRES_PASSWORD` in `.env` to the password you gave
`sessclone`, since that image creates the role from it. And step 2's psql runs
inside the cluster:

```bash
for file in supabase/migrations/*.sql; do
  echo "$file"
  docker compose exec -T db psql -v ON_ERROR_STOP=1 --single-transaction \
    -U sessclone -d sessclone < "$file" || exit 1
done
```

The Postgres port is published on loopback only. Reaching it from another
machine is a change to `compose.yaml` and a decision about who can see your
transcripts.

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
2. Signing in with no membership creates an Org and makes you its Owner —
   which is true of _everyone_ who signs in, not only the first person. On a
   deployment whose Supabase project accepts open sign-ups, every stranger who
   signs in gets their own Org on your box — locked until you approve it (step
   3), but a row nonetheless. If that is not what you want, restrict sign-ups
   in the Supabase project: an allow-list, or sign-ups disabled and accounts
   invited.
3. Your Org now shows **Waiting for approval**: every new Org is locked until
   a platform admin approves it (ticket 119), and that includes the first one
   on a self-hosted deployment. Make yourself the platform admin (the SQL in
   [Rates](#rates-so-the-costs-are-not-zero) below), open **/admin → Orgs**,
   and set your Org's Tier to `active`. Sign out and back in. A deployment
   with no need for approval — one person, or sign-ups already restricted in
   Supabase — can skip this with `SIGNUP_APPROVAL=off` (see
   [configuration](configuration.md#sign-up-approval)).
4. Issue a key under **Keys**.
5. Install the Collector on a machine: `docs/install.md`, which is two
   commands, the key, and a restart of Claude Code.
6. Run a Claude Code session. The Turn appears under **Costs** as soon as the
   session's first response finishes.

If nothing arrives, `docs/install.md` § "Checking it worked" has the list in
the order worth checking, and the Collector's own session-start message names
the common causes. Nothing about a failed report is silent on the machine and
invisible in the dashboard: **Costs → Failures** shows what the Collector
recorded.

## Rates, so the costs are not zero

The published prices as of 2026-09-21 arrive seeded by
`supabase/migrations/20260921090000_rate_seed.sql`, along with the Tier table,
so a fresh deployment prices Turns without anybody visiting the admin panel. A
model published after that date has no Rate, and a Turn with no matching Rate
is _unpriced_, never zero — every total carries the count of unpriced Turns
beside it.

Adding one is the admin panel's job, under **/admin → Rates**, which needs the
platform admin flag on your `users` row. That flag is guarded by a trigger so
that only a platform admin may grant it, and the guard fires for the owning
role too — the first one on a deployment therefore has to step around it once:

```sql
alter table users disable trigger users_guard_platform_admin;
update users set is_platform_admin = true
 where lower(email) = lower('you@example.com');
alter table users enable trigger users_guard_platform_admin;
```

As the owning role, in a `psql` session. Every later platform admin is granted
from inside the panel.

To catch up with a later price list, set `PRICING_URL` (see
[configuration](configuration.md#published-pricing)) and press **Fetch latest
pricing** on the same page. It lists each model whose published prices differ
from yours; nothing is written until you tick a model and apply it. A model new
to your list is priced from 2026-01-01, so the Turns already waiting for it
price; a changed price holds from the day you apply it.

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
