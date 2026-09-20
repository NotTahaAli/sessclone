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

> **Most of this is not wired up yet.** v1 is mid-build. Exactly two variables
> are read by code today: `DATABASE_URL` (`apps/web/app/api/probe/route.ts`)
> and `SESSCLONE_URL` (`packages/plugin/hooks/stop.mjs`). Every other row below
> is a commitment this build is working towards, and each section names the
> ticket that wires it. Setting one today does nothing — which is worth knowing
> before wondering why a bucket stays empty.

**Nothing here is a secret.** Every value below is an example or a default.
Real credentials live in `.env`, which is gitignored, or in the deployment's
own secret store.

## Server — `apps/web`

### Database

| Variable       | Required | Default | What it is                                                              |
| -------------- | -------- | ------- | ----------------------------------------------------------------------- |
| `DATABASE_URL` | yes      | — \*    | Postgres connection string. Any Postgres; Supabase is not a requirement |

\* **No default, deliberately.** `apps/web/vitest.config.mts` supplies
`postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test` to the test
harness, and that is the only place a fallback exists. The application itself
throws `DATABASE_URL is not set` on the first request that needs a connection,
because `postgres(undefined)` silently connects to localhost as the OS user and
surfaces a forgotten variable as `role "..." does not exist` three layers down.
The throw is per-request rather than at startup: the client is built lazily so
that `next build` does not open a connection.

Authorisation lives in row-level security (ADR 0001), so the policies travel in
`supabase/migrations/` and a self-hoster gets the same enforcement by applying
them.

### Supabase (auth and the browser client)

The browser reads scoped rows directly, through the same policies the server
uses. These three are that client's configuration. Wired by ticket 27
(sign-in and org creation); nothing reads them today.

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

Invitation and sign-in email is sent by Supabase Auth and configured in the
Supabase project's own SMTP settings, not here.

### Public base URL

| Variable              | Required | Default | What it is                                                                                 |
| --------------------- | -------- | ------- | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_APP_URL` | yes      | —       | Origin this deployment answers on, e.g. `https://sessclone.example.com`. No trailing slash |

Wired by tickets 49 (invites) and 66 (install docs); nothing reads it today.
Used to build invite links and the install instructions a Member is shown, so a
self-hoster's team is told to report to the self-hoster's deployment. It is not
derived from request headers: a forwarded `Host` is attacker-controllable, and
an invite link is a credential.

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

## Collector — `packages/plugin`

The Collector runs on a Member's own machine, one install per machine. Its
configuration is read from the environment so that a self-hoster's team can
point at their own deployment without editing a vendored plugin.

| Variable              | Required       | Default                 | What it is                                                                          |
| --------------------- | -------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| `SESSCLONE_URL`       | in practice \* | `http://127.0.0.1:3000` | Base URL of the deployment to report to. Matches the server's `NEXT_PUBLIC_APP_URL` |
| `SESSCLONE_API_KEY`   | yes            | —                       | The Member's API key, issued in the dashboard. Identifies the Member and the Org    |
| `SESSCLONE_STATE_DIR` | no             | platform-dependent \*\* | Where the cursor and the retry queue are kept                                       |

\* Not required by the code — `packages/plugin/hooks/stop.mjs` falls back to
`http://127.0.0.1:3000` — but required by anyone whose deployment is not on
their own laptop, which is everyone. The fallback is a development
convenience, and the table says "in practice" rather than "yes" because
claiming the code enforces something it does not is how a contract stops being
one. Ticket 32 is where a missing or malformed **key** fails loudly at setup
rather than silently at report time, and ticket 66's marketplace manifest is
where a hosted default for the URL would be set.

`SESSCLONE_API_KEY` is never written to a log, a transcript, or an error
message. It is read by ticket 32; nothing reads it today. The Collector sends
Usage only — never prompts, never code.

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
