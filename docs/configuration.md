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

> **Most of this is not wired up yet.** v1 is mid-build. Nine variables are
> read by code today: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_APP_URL` in `apps/web` since
> ticket 27 wired sign-in, `INGEST_DATABASE_URL` in `apps/web/app/api/ingest/route.ts`
> since ticket 31, and — since ticket 32 —
> `SESSCLONE_API_KEY`, `SESSCLONE_URL`, `SESSCLONE_STATE_DIR` and
> `SESSCLONE_DEVICE` in `packages/plugin/src/configuration.mjs`. Every other
> row below is
> a commitment this build is working towards, and each section names the ticket
> that wires it. Setting one today does nothing — which is worth knowing before
> wondering why a bucket stays empty.

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
`DATABASE_URL` must not be — and `apps/web/app/api/ingest/route.ts` is the only
code that reads it, which is what keeps a privileged connection to one named
purpose instead of letting it leak into a page.

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
uses. These three are that client's configuration, and ticket 27 wired them:
`apps/web/lib/supabase/server.ts` and `apps/web/proxy.ts` read the first two.
The service role key is still read by nothing, and ADR 0001 keeps it that way
until an ingest path needs it.

Sign-in is GitHub OAuth and a magic link, and no password is created or stored
by either. Both are configured in the Supabase project: GitHub needs a client
id and secret under Authentication, and both need
`<NEXT_PUBLIC_APP_URL>/auth/callback` in the project's list of allowed redirect
URLs — that one route handles the OAuth code and the magic link's token alike.

| Variable                        | Required | Default | What it is                                                                     |
| ------------------------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes      | —       | Project URL. `NEXT_PUBLIC_` because the browser needs it                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes      | —       | Anon key. Public by design; RLS is what protects the rows, not this key        |
| `SUPABASE_SERVICE_ROLE_KEY`     | yes      | —       | **Bypasses every policy.** Server-only, ingest paths only — see the note below |

`SUPABASE_SERVICE_ROLE_KEY` is the most dangerous value in this file. ADR 0001
confines it to ingest paths that have already verified an API key by hash. It
is never read in a page, a client component, or anything else the browser can
reach, and never used to work around an inconvenient policy. It carries no
`NEXT_PUBLIC_` prefix precisely so that a mistake is a build-time absence
rather than a shipped credential.

Sign-in email — the magic link — is sent by Supabase Auth and configured in
the Supabase project's own SMTP settings, not here. The **invitation** email is
different: an invitation is this app's own `/join/<token>` route, which Supabase
never sees, so it is sent through the app's own SMTP, below.

### Invitation email (SMTP)

| Variable    | Required | Default | What it is                                                                      |
| ----------- | -------- | ------- | ------------------------------------------------------------------------------- |
| `SMTP_URL`  | no       | —       | Connection URL, e.g. `smtp://user:pass@smtp.example.com:587` or `smtps://…:465` |
| `SMTP_FROM` | no       | —       | From address on the invitation, e.g. `sessclone <no-reply@example.com>`         |

Both or neither. With them set (ticket 82, `apps/web/lib/mailer.ts`), inviting
someone emails them the join link; with either unset, no mail is attempted and
the inviter is told to pass the copyable link on themselves — the same link the
email would carry, never a second token. A send that fails for a configured
server is reported the same way, because the inviter's remedy is identical.

`smtp://` uses STARTTLS when the server offers it; `smtps://` is TLS from the
first byte. The credentials live in `SMTP_URL` and are read server-side only —
they carry no `NEXT_PUBLIC_` prefix and reach no page or log line.

### Public base URL

| Variable              | Required | Default | What it is                                                                                 |
| --------------------- | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL` | yes      | —       | Origin this deployment answers on, e.g. `https://sessclone.example.com`. No trailing slash |

Wired by ticket 27 (`apps/web/lib/auth/app-url.ts`), and used again by tickets
49 (invites) and 66 (install docs).
Used to build the sign-in redirect, invite links and the install instructions a
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

### Storage

Log Artifacts go straight to storage through a presigned PUT; the application
never carries the bytes (ADR 0003). Only the S3 API is used, so Supabase
Storage, Cloudflare R2, AWS S3, Oracle Cloud Object Storage, and MinIO are all
the same code path. Wired by ticket 58 (the presign route); nothing reads any
of these today, and ticket 67 is where two providers get proven.

| Variable                      | Required | Default | What it is                                                                        |
| ----------------------------- | -------- | ------- | --------------------------------------------------------------------------------- |
| `STORAGE_ENDPOINT`            | yes      | —       | S3 API endpoint URL. The provider's S3 endpoint, not its dashboard                |
| `STORAGE_REGION`              | no       | `auto`  | Region. `auto` suits R2 and Supabase; AWS needs the real one, e.g. `eu-west-2`    |
| `STORAGE_BUCKET`              | yes      | —       | Bucket holding artifacts. Must **not** be public: reads are presigned per request |
| `STORAGE_ACCESS_KEY_ID`       | yes      | —       | Access key id                                                                     |
| `STORAGE_SECRET_ACCESS_KEY`   | yes      | —       | Secret access key                                                                 |
| `STORAGE_FORCE_PATH_STYLE`    | no       | `true`  | Path-style addressing. Required by MinIO and Supabase; AWS accepts it             |
| `STORAGE_PRESIGN_TTL_SECONDS` | no       | `300`   | Life of an issued URL. A presigned URL is a bearer credential — keep it short     |

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

| Variable              | Required       | Default                 | What it is                                                                          |
| --------------------- | -------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `SESSCLONE_URL`       | in practice \* | `http://127.0.0.1:3000` | Base URL of the deployment to report to. Matches the server's `NEXT_PUBLIC_APP_URL` |
| `SESSCLONE_API_KEY`   | yes            | —                       | The Member's API key, issued in the dashboard. Identifies the Member and the Org    |
| `SESSCLONE_STATE_DIR` | no             | platform-dependent \*\* | Where the cursor and the retry queue are kept                                       |
| `SESSCLONE_DEVICE`    | no             | derived \*\*\*          | Pins this environment's Device key instead of deriving one                          |

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
one. Ticket 66's marketplace manifest is where a hosted default for the URL
would be set. A value that is not an `http` or `https` URL is refused with the
rest, because a `fetch` against one fails per report with a message about a
protocol rather than once with a message about a variable.

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

Only the Linux row is observed on a real machine. macOS and Windows rest on
Anthropic's documentation and on the installed CLI's own path resolution
(finding 06), and ticket 06 stays open until someone runs this on both — so
treat those two rows as the intended behaviour rather than the measured one.

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
