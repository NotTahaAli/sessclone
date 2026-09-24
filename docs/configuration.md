# Configuration

The three dependencies a self-hoster has to supply are reached by plain
configuration, with no provider in the code path: the database is a Postgres
URL, storage is any S3-compatible endpoint, and the public base URL is whatever
the deployment answers on. That is what makes self-hosting (ticket 67) a
configuration exercise rather than a fork. Auth is the exception and is named
as one — it is Supabase Auth, and three of the variables below say so.

This file is the contract. `.env.example` is the same list in copyable form,
carrying no real values, and `packages/shared/src/configuration.test.ts` fails
if the two ever disagree — a variable added to one and not the other, or a
default written differently in each, is a test failure rather than a support
ticket.

Every variable in the tables below is read by code today, except `CRON_SECRET`,
which is read by Vercel's scheduler rather than by this application (see
[Retention sweep](#retention-sweep)). **Required** means the code throws, or
the feature refuses to run, without it; **Default** is what the code falls back
to when it is unset.

**Nothing here is a secret.** Every value below is an example or a default.
Real credentials live in `.env`, which is gitignored, or in the deployment's
own secret store.

**The server's `.env` belongs in `apps/web`,** not at the repo root beside
`.env.example`. Next.js reads environment files from its own project root, so a
root `.env` is loaded by nothing and the first page that needs one fails with
`NEXT_PUBLIC_SUPABASE_URL is not set` rather than saying where it looked.

## Server — `apps/web`

### Database

| Variable              | Required | Default | What it is                                                                  |
| --------------------- | -------- | ------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`        | yes      | — \*    | Everything the dashboard reads. Any Postgres; Supabase is not a requirement |
| `INGEST_DATABASE_URL` | yes      | — \*    | What the ingest route writes as. The owning role, **not** `sessclone_app`   |

\* **No default, deliberately, for either.** `apps/web/vitest.config.mts`
supplies both `sessclone_test` URLs to the test harness, and that is the only
place a fallback exists. The application itself throws
`DATABASE_URL is not set` — or `INGEST_DATABASE_URL is not set` — on the first
request that needs that connection,
because `postgres(undefined)` silently connects to localhost as the OS user and
surfaces a forgotten variable as `role "..." does not exist` three layers down.
The throw is per-request rather than at startup: the client is built lazily so
that `next build` does not open a connection.

**Point it at a role that owns nothing.** The policies below are
`enable row level security` and not `force`, and Postgres applies no policy at
all to a superuser or to the role that owns the tables — so a deployment that
connects as the role which applied the migrations has row-level security
switched off and no error to say so. `supabase/migrations/20260920120200_app_role.sql`
creates `sessclone_app` for this, with the grants the dashboard needs and
nothing else; give it a password (or grant it to a login role that has one) and
put _that_ in `DATABASE_URL`. ADR 0007 has the reasoning, and
`apps/web/test/app-role.test.ts` fails if the dashboard is pointed back at a
privileged role.

**Two variables, because they are two roles.** `sessclone_app` is the right
role for everything the dashboard reads, and the wrong one for ingest: ingest
writes `turns` and `log_artifacts`, which carry no insert policy by design and
which `sessclone_app` is granted no insert on at all. So ticket 31 gave ingest
its own variable. `INGEST_DATABASE_URL` is the migrating, owning role — the one
`DATABASE_URL` must not be. It is read only by `ingestDb()` in
`apps/web/lib/collector-auth.ts`, and only the API-key-authenticated Collector
routes (`/api/ingest`, `/api/logs/presign`, `/api/logs/confirm`) and the
secret-gated retention sweep call that, which is what keeps a privileged
connection to named purposes instead of letting it leak into a page.

**There is deliberately no fallback between them.** A missing
`INGEST_DATABASE_URL` throws `INGEST_DATABASE_URL is not set` on the first
report rather than quietly borrowing `DATABASE_URL`: a silent fallback would
make a correct deployment fail on every report and a misconfigured one — both
pointed at the owning role, row-level security off — appear to work, which is
the whole failure this split exists to prevent.

**What one report may carry.** The ingest route bounds the batch at the
boundary, so an absurd payload is a 400 naming the limit rather than a request
that times out: at most **100 reports** in a payload, **5000 turns** in a
report, and **100 stop failures** in a payload, each with a message of at most
2000 characters (`packages/shared/src/ingest.ts`). A Collector draining a queue larger
than that splits it across requests, which it can do safely because the cursor
travels per report and re-reporting is absorbed by the identity index (ADR
0006). A batch the database itself refuses is a 400 with the reason — retrying
it unchanged would stall the cursor forever — while a database that is merely
unavailable is a 503, which is the Collector's signal to queue and retry. Both
roll back whole: a refused report writes no Device and no Project row.

Authorisation lives in row-level security (ADR 0001), so the policies travel in
`supabase/migrations/` and a self-hoster gets the same enforcement by applying
them.

### Supabase (auth and the browser client)

The browser reads scoped rows directly, through the same policies the server
uses. These two are that client's configuration, read by
`apps/web/lib/supabase/server.ts` and `apps/web/proxy.ts`.

There is no `SUPABASE_SERVICE_ROLE_KEY`. No code reads one, so a deployment
should not hold one: it bypasses every policy, and ingest already writes as the
owning role through `INGEST_DATABASE_URL`. ADR 0001 confines a service role key
to ingest paths that have already verified an API key by hash, should one ever
need it.

Sign-in is GitHub OAuth and a magic link, and no password is created or stored
by either. Both are configured in the Supabase project: GitHub needs a client
id and secret under Authentication, and both need
`<NEXT_PUBLIC_APP_URL>/auth/callback` in the project's list of allowed redirect
URLs — that one route handles the OAuth code and the magic link's token alike.

| Variable                        | Required | Default | What it is                                                              |
| ------------------------------- | -------- | ------- | ----------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes      | —       | Project URL. `NEXT_PUBLIC_` because the browser needs it                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes      | —       | Anon key. Public by design; RLS is what protects the rows, not this key |

Sign-in email — the magic link — is sent by Supabase Auth and configured in
the Supabase project's own SMTP settings, not here. The **invitation** email is
different: an invitation is this app's own `/join/<token>` route, which Supabase
never sees, so it is sent through the app's own SMTP, below.

### Email (SMTP)

| Variable    | Required | Default | What it is                                                                      |
| ----------- | -------- | ------- | ------------------------------------------------------------------------------- |
| `SMTP_URL`  | no       | —       | Connection URL, e.g. `smtp://user:pass@smtp.example.com:587` or `smtps://…:465` |
| `SMTP_FROM` | no       | —       | From address on the invitation, e.g. `SessClone <no-reply@example.com>`         |

Both or neither. With them set (ticket 82, `apps/web/lib/mailer.ts`), inviting
someone emails them the join link; with either unset, no mail is attempted and
the inviter is told to pass the copyable link on themselves — the same link the
email would carry, never a second token. A send that fails for a configured
server is reported the same way, because the inviter's remedy is identical.

The same two variables send the platform admins a note each time somebody
signs up and creates an Org waiting for approval (ticket 120,
`apps/web/lib/signup-notice.ts`), with a link to that Org under **/admin →
Orgs**. Unset, nothing is sent; the Admin panel lists waiting Orgs first and
counts them on its navigation link either way.

`smtp://` uses STARTTLS when the server offers it; `smtps://` is TLS from the
first byte. The credentials live in `SMTP_URL` and are read server-side only —
they carry no `NEXT_PUBLIC_` prefix and reach no page or log line.

### Sign-up approval

| Variable          | Required | Default | What it is                                                    |
| ----------------- | -------- | ------- | ------------------------------------------------------------- |
| `SIGNUP_APPROVAL` | no       | on      | `off` lets a new Org in without a platform admin approving it |

On by default, self-hosted deployments included (ticket 119,
`apps/web/lib/approval.ts`). An Org whose subscription is `inactive` — which is
where every sign-up starts, on the plan it picked (ticket 118) — or which has
no subscription row, or is `cancelled`, is locked: the dashboard shows only
"Waiting for approval" (or "Cancelled") and Sign out, no key can be created,
and ingest answers its existing keys with the same 401 as any unknown key.
`past_due` is not locked; it keeps its banner and works. A platform admin
approves an Org by setting it `active` under **/admin → Orgs**, where Orgs
waiting for approval are listed first.

Any value other than `off` (case-insensitive) leaves it on. With it off, every
status behaves as before the lock: a notice on every page, collection working.
Read per request, so a restart is enough to change it.

### Published pricing

| Variable      | Required | Default | What it is                                                                                |
| ------------- | -------- | ------- | ----------------------------------------------------------------------------------------- |
| `PRICING_URL` | no       | —       | Markdown pricing page, e.g. `https://platform.claude.com/docs/en/about-claude/pricing.md` |

Read by "Fetch latest pricing" on `/admin/rates` (ticket 97,
`apps/web/lib/rate-sync.ts`), server-side only. Unset, the button says so and
nothing is fetched. Nothing fetched is written until the platform administrator
approves it.

### Public base URL

| Variable              | Required | Default | What it is                                                                                 |
| --------------------- | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL` | yes      | —       | Origin this deployment answers on, e.g. `https://sessclone.example.com`. No trailing slash |

Read by `apps/web/lib/auth/app-url.ts`, which throws when it is unset, and by
`apps/web/lib/appearance.ts`, which marks its cookie `Secure` when the URL is
`https://`. Used to build the sign-in redirect, invite links and the install instructions a
Member is shown, so a
self-hoster's team is told to report to the self-hoster's deployment. It is not
derived from request headers: a forwarded `Host` is attacker-controllable, and
an invite link is a credential.

An invite link is a credential that travels in a URL, which is worth knowing
when you decide how invitations are delivered. Somebody who opens one while
signed out is sent to sign in and back, so the token passes through the auth
provider's `redirect_to` — and, for GitHub sign-in, through GitHub — and it
lands in whatever request logs sit in front of the deployment. It is still only
usable by the address it names, which the database checks against the account's
own verified address, and accepting it takes a deliberate press rather than a
page load. Treat a link in a chat message the way you would treat a password
reset link, and revoke one you think has been seen.

### Retention sweep

Retention is a window per Org, in days, set by an Owner or an Admin under Org
settings and capped by the Tier's ceiling. The application runs no scheduler
of its own: `POST /api/retention/sweep` (or `GET`, for schedulers that only
send GET) is the call that removes what is past the window —
the `log_artifacts` rows and the stored objects together, oldest first, at most
500 per call, and it answers how many remain so a backlog can be drained by
calling again. It is idempotent: nothing is past its window twice, and deleting
an object that is already gone succeeds.

**Turns are never touched by it.** The spend history is append-only and
survives every transcript it describes.

| Variable                 | Required    | Default | What it is                                                                                |
| ------------------------ | ----------- | ------- | ----------------------------------------------------------------------------------------- |
| `RETENTION_SWEEP_SECRET` | no          | —       | Shared secret for `/api/retention/sweep`. Unset means the route refuses every call        |
| `CRON_SECRET`            | Vercel only | —       | Read by Vercel Cron, not by the app. Set it to the same value as `RETENTION_SWEEP_SECRET` |

**Who calls it.** On Vercel, `apps/web/vercel.json` schedules a daily
`GET /api/retention/sweep`, and Vercel Cron sends
`Authorization: Bearer $CRON_SECRET` with it — so the call is accepted only
when `CRON_SECRET` equals `RETENTION_SWEEP_SECRET`. Anywhere else, schedule
your own `POST` or `GET` with `Authorization: Bearer <RETENTION_SWEEP_SECRET>`.

The window is measured from when a transcript was first stored, not from its
last upload: a growing Session replaces its object and moves `uploaded_at`, so
a window measured from that would be days since the last write and a busy
Session would never age out.

The route answers `200` with `{removed, remaining}`, `401` for a wrong secret,
`503` when the secret is unset, `503` when storage is not configured — nothing
is removed in that case, because the rows and the objects go together — and
`503` when the sweep itself failed, which rolls the rows back. Two sweeps at
once are safe: the second is told there is more to do and removes nothing,
rather than reading a half-finished picture as an empty backlog.

**Upgrading an existing deployment sets every Org to 90 days.** The column
arrived with that default, and no Org chose it, so the _first_ sweep on a
deployment that has been collecting for longer destroys every transcript older
than 90 days. Nothing happens until the route is called and the route needs
this secret, so the order is: set the windows, then configure the sweep.

```sql
update orgs set retention_days = 365;   -- or per Org, before sweeping
```

Org settings says when retention last ran on the deployment, or that it never
has, so an Owner reading a window can tell whether anything enforces it.

Unset is the safe default on purpose: this endpoint destroys transcripts, so a
deployment that has not configured a sweep keeps everything rather than leaving
a destructive route open. The secret travels as `Authorization: Bearer <secret>`
and is compared in constant time, as the pricing route's is. The sweep runs as
the owning role — it crosses every Org, while a Member's own delete is all the
policies allow (ADR 0005) — which is why it is a secret-gated route and not
anything a browser can reach.

### Public pages (optional)

| Variable                                 | Required | Default | What it is                                                                          |
| ---------------------------------------- | -------- | ------- | ----------------------------------------------------------------------------------- |
| `SEARCH_INDEXING`                        | no       | off     | `on` lets search engines crawl the public pages. Anything else blocks every crawler |
| `NEXT_PUBLIC_CONTACT_EMAIL`              | no       | —       | Address the public pages offer for contact. Unset, contact links are hidden         |
| `NEXT_PUBLIC_CLOUDFLARE_ANALYTICS_TOKEN` | no       | —       | Cloudflare Web Analytics site token. Cookieless; marketing pages and docs           |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID`         | no       | —       | Microsoft Clarity project id. Marketing pages only, never the dashboard             |

Read in `apps/web/lib/site.ts` and the two analytics components. A self-hosted
copy stays out of search results and loads no analytics unless its operator
sets these. Canonical links, the sitemap and `llms.txt` are built from
`NEXT_PUBLIC_APP_URL`. Clarity asks visitors in Europe first and does not load
if they decline (`apps/web/app/(marketing)/clarity.tsx`). The `NEXT_PUBLIC_`
variables are read at build time, so a change needs a redeploy.

The Privacy and Terms pages describe the hosted service at sessclone.com: its
providers and its analytics. Replace them with your own before you open a
deployment to people outside your team.

### Storage

Log Artifacts go straight to storage through a presigned PUT; the application
never carries the bytes (ADR 0003). Only the S3 API is used, so Supabase
Storage, Cloudflare R2, AWS S3, Oracle Cloud Object Storage, and MinIO are all
the same code path (`apps/web/lib/storage.ts`).

Storage is optional as a whole. With any of the four "for archival" variables
unset, archival is off — presign refuses, the retention sweep answers 503 —
and everything else works.

| Variable                       | Required     | Default | What it is                                                                               |
| ------------------------------ | ------------ | ------- | ---------------------------------------------------------------------------------------- |
| `STORAGE_ENDPOINT`             | for archival | —       | S3 API endpoint URL. The provider's S3 endpoint, not its dashboard                       |
| `STORAGE_REGION`               | no           | `auto`  | Region. `auto` suits R2 and Supabase; AWS needs the real one, e.g. `eu-west-2`           |
| `STORAGE_BUCKET`               | for archival | —       | Bucket holding artifacts. Must **not** be public: reads are presigned per request        |
| `STORAGE_ACCESS_KEY_ID`        | for archival | —       | Access key id                                                                            |
| `STORAGE_SECRET_ACCESS_KEY`    | for archival | —       | Secret access key                                                                        |
| `STORAGE_FORCE_PATH_STYLE`     | no           | `true`  | Path-style addressing. Required by MinIO and Supabase; AWS accepts it                    |
| `STORAGE_PRESIGN_TTL_SECONDS`  | no           | `300`   | Life of an issued URL. A presigned URL is a bearer credential — keep it short            |
| `STORAGE_COMPAT_CREATE_BUCKET` | no           | —       | `apps/web/scripts/storage-compat.mjs` only: `true` creates the bucket before checking it |

### Pricing cache

The public pricing pages read the `tiers` table and cache the read under the
tag `tiers`. Saving a Tier on `/admin/tiers` clears that cache itself, so an
operator who works in the panel needs nothing here.

`POST /api/pricing/revalidate` is the other way in, for a Tier changed outside
the panel — by hand in `psql`, by a billing webhook, or by whatever a
self-hoster runs against their own database. It takes
`Authorization: Bearer <secret>` and answers 503 while no secret is set, so a
deployment that never configures one has no open cache-clearing endpoint.

| Variable                    | Required | Default | What it is                                                                                 |
| --------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `PRICING_REVALIDATE_SECRET` | no       | —       | Shared secret for `POST /api/pricing/revalidate`. Unset means the route refuses every call |

The secret is a bearer token: it is replayable, and the route is not rate
limited. That is deliberate — the only thing it does is clear a cache, which
is cheap to ask for repeatedly — but it is a reason to rotate it like any
other credential rather than to publish it.

Two things about this cache are worth knowing before a deployment grows:

**It is per instance.** `updateTag` and `revalidateTag` clear the cache of the
process that runs them. One server behind one process sees a saved price
immediately. Several instances, or a serverless deployment, do not: the
instance that handled the save is fresh and the others carry their old copy
until their own revalidation window passes. Nothing here is wrong on any of
them — the price is simply older — but a deployment that wants them to agree
at once needs a shared cache handler (`cacheHandlers` in `next.config.ts`),
or must call the route through something that reaches every instance.

**The build does not need the database.** The pricing pages are prerendered,
so `next build` reads the Tiers if it can. If it cannot — no `DATABASE_URL`,
or no Postgres to reach, as in a container build — the build still succeeds
and those pages ship with the cards replaced by a short "not loading right
now" notice, which the first successful read after start-up replaces. A price
is never written into the build, which is the whole point of reading it from
the table.

## Docker Compose — `compose.yaml`

Three variables read by compose itself rather than by any process it starts.
They live in the `.env` at the repository root, which is the file compose
reads; the application's own variables are read from that same file and handed
to the container. A deployment that runs the app directly rather than in a
container needs none of them.

| Variable            | Required       | Default | What it is                                                                   |
| ------------------- | -------------- | ------- | ---------------------------------------------------------------------------- |
| `WEB_PORT`          | no             | `3000`  | Host port the dashboard is published on. Deliberately not `PORT` — see below |
| `POSTGRES_PASSWORD` | with `db` only | —       | Password for the `sessclone` role in the bundled Postgres (`--profile db`)   |
| `POSTGRES_PORT`     | no             | `5432`  | Host port the bundled Postgres is published on, bound to loopback            |

`WEB_PORT` is not named `PORT` because `next start` reads `PORT` as the port it
listens on _inside_ the container, and the same file is handed to both. One
variable for both would publish `8080:3000` while the server moved to 8080, and
nothing would answer.

`POSTGRES_PASSWORD` carries no compose-level requirement even though the `db`
service cannot start without it: compose interpolates every service's variables
whether or not that service's profile is active, so a required value here would
refuse `docker compose up` on a deployment that brings its own database. Left
unset with the profile in use, the Postgres image refuses to initialise and
says why.

## Collector — `packages/plugin`

The Collector runs on a Member's own machine, one install per machine. Its
configuration is read from the environment so that a self-hoster's team can
point at their own deployment without editing a vendored plugin.

**It needs Node 22.18 or newer** (or 23.6, or any 24). The hooks are run as
`node <file>` with no build step, and the parser and identity rules they
import from `packages/shared` are TypeScript that Node executes by stripping
the types — which is on by default from those versions and not before. On an
older Node that import throws, and `stop.mjs` performs it inside its own
`try` for that reason: the plugin installs, starts cleanly, reports nothing
and says nothing, rather than printing a stack trace on every turn into the
transcript this product then uploads. The session-start check names the
problem instead, beside the variables below.

`docs/install.md` is the install path itself — the two commands, the restart,
the backfill, and the environments with no shell to export a variable in. This
section is the variables it sets.

The hooks import those modules by relative path, which reaches outside the
plugin directory into the same clone. That is how the marketplace entry
installs it (`.claude-plugin/marketplace.json` points at `./packages/plugin`
inside this repository), but an install that copies only the plugin directory
has no `packages/shared` to reach and reports nothing — silently, for the same
reason as above.

| Variable              | Required       | Default                 | What it is                                                                           |
| --------------------- | -------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `SESSCLONE_URL`       | in practice \* | `http://127.0.0.1:3000` | Base URL of the deployment to report to. Matches the server's `NEXT_PUBLIC_APP_URL`  |
| `SESSCLONE_API_KEY`   | yes            | —                       | The Member's API key, issued in the dashboard. Identifies the Member and the Org     |
| `SESSCLONE_STATE_DIR` | no             | platform-dependent \*\* | Where the cursor and the retry queue are kept                                        |
| `SESSCLONE_DEVICE`    | no             | derived \*\*\*          | Pins this environment's Device key instead of deriving one                           |
| `SESSCLONE_DEBUG`     | no             | —                       | Set to anything to print a hook's swallowed failure to stderr. Off, a hook is silent |

The Collector keeps one cursor per transcript under
`<state dir>/cursors/<hash>.json`: per file rather than per Session, because a
subagent's transcript and its parent's are appended to independently (finding
74), and named by a hash because a transcript path carries the Member's own
directory names. A cursor is a cache and never a record — missing, unreadable
or past the end of a replaced file all mean "read from the top", which costs
bandwidth and never a Turn. It is stored only after the deployment accepted
the report carrying it.

One request carries at most 100 reports of at most 5,000 Turns each, and at
most 100 stop failures (`packages/shared/src/limits.ts`, which both ends
import). The Collector
splits a long transcript across requests itself rather than sending one the
route refuses: a session past the limit would otherwise be refused on every
Stop for the rest of its life, and nothing reads the answer.

A request may also carry **stop failures** and no Turns at all. `StopFailure`
fires on a turn that ended on an API error — a rate limit, an overload, a
billing problem — which writes no usage and so appears in no Turn. The hook
sends the error type, the error detail Claude Code reported, and the time it
fired, against the Session; it reads no transcript and moves no cursor, so the
Turns before the failure are still the next `Stop`'s to report. A payload
carrying neither a report nor a failure is a 400.

**Archival is the deployment's decision, not the Collector's (ticket 59).**
A Member who has opted in has their transcripts uploaded at the end of each
session and by the `SessionStart` sweep: the Collector hashes the transcript,
asks `/api/logs/presign`, and opens the file for upload only if that answer is
a URL. So nothing leaves the machine while the master switch is off, while the
Project is excluded, while the Tier excludes archival, or when these exact
bytes are already stored — each of which costs one small request per
transcript and no transfer, and is then remembered under
`<state dir>/archived/` so an unchanged transcript is not re-read on the next
start. The bytes then go straight to storage (ADR 0003), and a second
request, `/api/logs/confirm`, is what records the upload: the row is written
only once the deployment has read the object back out of the bucket, so a
failed or truncated upload leaves no row claiming a transcript is downloadable.
The Collector needs no configuration for any of this, and holds no copy of the
switch.

Two limits are worth knowing. The upload is bounded to the transcript's size as
it stood when the hash was taken, so a session that is still being written is
archived up to that point and the rest goes on the next pass. And archival
shares the `SessionStart` sweep's time box with the Turns, which are reported
first — so on a machine with a long history the newest sessions are archived
first and the older ones over subsequent starts, while a session that ends
cleanly is archived by `SessionEnd` in its own eight-second budget.

A Claude Code cloud container (`CLAUDE_CODE_REMOTE=true`) gets neither of those
moments: it never runs `SessionEnd`, and the next session starts in a fresh
container without this one's files. So there a second `Stop` hook,
`hooks/stop-archive.mjs`, archives the Session's transcripts after every turn
(ticket 99). It is registered `async: true`, so the turn never waits on it and
Claude Code enforces no timeout; its own budget is sixty seconds, and one
upload may take fifty of them rather than the eight a synchronous hook allows.
Each pass uploads what has changed and confirms it before it ends, so a
container reclaimed between turns loses nothing stored. Runs for one Session
take a lock under `<state dir>/archived/`, so a quick next turn waits for the
previous upload instead of racing it, and a presign refused `no_turns` (the
first turn beating its own flush) is asked once more after three seconds. On
any other machine the hook exits at once.

**What goes up per turn is the new bytes, not the session (ticket 131, ADR
0008).** A transcript is stored as sealed chunks followed by one raw tail. The
presign answer says how many bytes are sealed and their SHA-256; the Collector
re-hashes that prefix from local disk, which sends nothing, and uploads only
what lies past it. A turn that seals nothing sends the tail alone: the bytes
after the last chunk, under about 1 MiB and usually far less, plus the same two
small requests as before. Once the unsealed part reaches 1 MiB, the pass cuts
it at the first line end at or after each 1 MiB, never inside a line, and sends
up to 16 such chunks gzipped (`application/gzip`, no `Content-Encoding`) after
one extra presign, then the shorter tail. A transcript under 1 MiB never seals,
so it is stored and sent exactly as before. The Collector falls back to sending
the whole file when the file is shorter than the sealed bytes or its prefix
hashes differently (rewritten or truncated), when compression fails, or when
the deployment does not answer `layout: 'chunked'` (one that predates ADR
0008); that confirm drops the old chunks. The first pass over a long transcript
that has no chunks yet seals 16 MiB at most and sends the rest as the tail, so
it converges over a few passes. Sidecars (`agent_meta`, `workflow_journal`)
are always sent whole; Agent Run transcripts chunk like the main one.

**When the deployment is unreachable, nothing is lost to a blip and little to
an outage (ticket 39).** A failed report is retried three times over about two
and a half seconds; a report that still will not go is written to a queue under
`<state dir>/queue/`, and the next session started in this environment drains
that queue and then re-reads every recent transcript from its cursor. So a
laptop that closed on a train, or a deployment down for an hour, catches up on
its own at the next session with no Turn lost. The sweep is time-boxed to fit
inside the session-start hook, working newest-first, so a very large backlog —
a fresh install over a year of existing history, say — is caught up oldest-ward
across several sessions rather than all in one; each recovered session is
reported in full, and the ones not yet reached carry over to the next start.

**When the deployment refuses the key, it says so (ticket 98).** A refusal is
final, so it writes no cursor and queues nothing, and before ticket 98 a
Collector refused on every report left no trace at all: not even the state
directory. Now every report overwrites `<state dir>/last-answer.json` with the
status and the time, `node scripts/verify-collector.mjs` prints it, and a
session that starts after a `401` prints one line saying the key was refused.

**Behind a proxy, the Collector goes through it (ticket 98).** Node's `fetch`
ignores `HTTPS_PROXY` unless Node was started with `NODE_USE_ENV_PROXY=1`, and
the variable is read only at startup. So a hook that finds `HTTPS_PROXY` set
starts itself again with `NODE_USE_ENV_PROXY=1`, which also honours
`NO_PROXY`. It needs a Node that has the switch, 22.21 or newer; an older Node
connects directly, as before. This is what lets a Claude Code cloud
environment's API credential reach ingest: the credential is added by the
proxy, so a direct connection arrives with the placeholder key and is refused.

On a laptop behind a corporate proxy this changes the route too. A proxy that
inspects TLS needs its CA in `NODE_EXTRA_CA_CERTS`, and a proxy that wants
NTLM or Kerberos is not supported (only credentials in the proxy URL are). To
keep the old direct connection, put the deployment's host in `NO_PROXY`.

The residual gap — the one thing this does not guarantee — is a **stop failure
or a session-end marker** that is queued and then never drained, because the
state directory is read-only, the queue's 14-day age limit or 500-entry cap is
reached first, or no further session is ever started in this environment. A
dropped _Turn_ is always recovered, because the cursor did not advance and the
next session re-reads it; a dropped session **event** reads no transcript and
so has only the queue behind it. In practice this shows up as a session that
ran but whose failure or clean-end is missing from the dashboard — usage is
still counted from the Turns themselves. Keep the state directory writable (see
the default-path note below) and this gap stays closed.

\* Not required by the code — `readConfiguration` falls back to
`http://127.0.0.1:3000` — but required by anyone whose deployment is not on
their own laptop, which is everyone. The fallback is a development
convenience, and the table says "in practice" rather than "yes" because
claiming the code enforces something it does not is how a contract stops being
one. A value that is not an `http` or `https` URL is refused with the
rest, because a `fetch` against one fails per report with a message about a
protocol rather than once with a message about a variable.

**The plugin's own setup prompt is the other way in.**
`packages/plugin/.claude-plugin/plugin.json` declares `url` and `api_key` as
`userConfig`, so installing the plugin asks for both and keeps the key in the
keychain. Claude Code hands those answers to the hooks as
`CLAUDE_PLUGIN_OPTION_URL` and `CLAUDE_PLUGIN_OPTION_API_KEY`;
`readConfiguration` prefers `SESSCLONE_URL` and `SESSCLONE_API_KEY` when both
are set, and falls back to the plugin options otherwise. `docs/install.md` has
both routes.

**A bad key fails at setup, not at report time (ticket 32).**
`packages/plugin/src/configuration.mjs` reads every variable in this table and
checks it; `hooks/session-start.mjs` runs that check when a session starts —
which is the first thing to run after the restart the install instructions ask
for — and writes every problem it found, at once, where the person will see
it. A key that is absent, or that is not `sk_` and 43 base64url characters, is
one of those problems. Whether a well-formed key is _live_ is ingest's question
(ticket 34) and is not answerable from a machine.

`SESSCLONE_API_KEY` is never written to a log, a transcript, or an error
message — the check reports the first three characters and the length, and
`configuration.test.mjs` fails if a message ever carries more. That matters
more than it looks: a hook's stderr is shown inside a session, and a session is
a transcript this product then uploads. The Collector sends Usage only — never
prompts, never code.

\*\*\* The Device key is normally derived: `host:<hostname>` on a machine, and
`cloud:<account uuid>` in Claude Code Cloud, where the account outlives the
container and every container a Member burns through collapses into one Device.
Set this only when one account runs several environments that should be counted
separately — a CI fleet beside a laptop, say — because the derived key would
make them one Device. The value is used verbatim, so it is also the way to pin
an identity across a rename. Read by `deviceKey` in `packages/shared`, and
passed through by the Collector's own configuration.

\*\* The default resolves per platform, and deliberately never lands under
`~/.claude` — Claude Code's own `cleanupPeriodDays` sweep deletes everything
under `~/.claude/projects/` after 30 days by default, which would take the
cursor and the queue with it (finding 06):

| Platform | Default state directory                                                  |
| -------- | ------------------------------------------------------------------------ |
| Linux    | `$XDG_STATE_HOME/sessclone`, else `~/.local/state/sessclone`             |
| macOS    | `~/Library/Application Support/sessclone`                                |
| Windows  | `%LOCALAPPDATA%\sessclone`, else `%USERPROFILE%\AppData\Local\sessclone` |

All three rows are observed on real machines (finding 06): Linux and macOS
end to end, and on Windows the transcript layout was observed and the state
directory confirmed writable by the operator.

That 30-day sweep is also a deadline on archival: a transcript not collected
within the window is gone, whatever this product does.

`CLAUDE_CONFIG_DIR` is Claude Code's variable, not this product's. The
Collector reads it — resolving `CLAUDE_CONFIG_DIR ?? ~/.claude` exactly as
Claude Code does — to find transcripts, and never writes inside it.

## Not configured here

- **Rates.** Prices ship as reviewed migrations and are edited in the platform
  admin area, never read from the environment (ADR 0002). A price in an env var
  is a price nobody reviewed.
- **Tiers and Retention windows.** Rows in the database, set per Org, capped by
  the Tier.
- **The Org timezone.** An Org setting, because two Orgs on one deployment
  bucket their days differently.
