<div align="center">

# SessClone

**Your team runs Claude Code in three places. Count it as one.**

Claude Code usage and cost for a whole team: every Session from every laptop,
server and cloud environment lands in one dashboard, per Member, per Project,
per Device.

[![CI](https://github.com/NotTahaAli/sessclone/actions/workflows/ci.yml/badge.svg)](https://github.com/NotTahaAli/sessclone/actions/workflows/ci.yml)
[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue.svg)](LICENSE)
[![Collector: MIT](https://img.shields.io/badge/collector-MIT-green.svg)](packages/plugin/LICENSE)

[Website](https://sessclone.com) ·
[Docs](https://sessclone.com/docs) ·
[Self-hosting](https://sessclone.com/docs/self-hosting) ·
[Contributing](CONTRIBUTING.md)

</div>

<!-- ![SessClone dashboard](docs/assets/screenshot.png) -->

## What it does

- **A Collector that is a Claude Code plugin.** Two commands and a restart per
  machine. It reports usage only (token counts, models, timings), never a
  prompt or a file's contents.
- **Costs per Member, per Project and per Device.** Every Turn is priced from
  a reviewed rate table. A Turn with no matching rate is counted as unpriced,
  never as zero.
- **Sessions**, including subagent runs, resumed and forked sessions, and
  turns that ended on an API error.
- **A transcript viewer.** When a Member opts in, their raw session logs are
  archived to your own bucket and can be read in the dashboard or downloaded.
  Upload is off until each Member turns it on.
- **Retention.** Each Org sets a window in days, and a sweep removes
  transcripts older than that. Spend history is never deleted.
- **Orgs and Roles.** Owner, Admin, Manager (who sees only the Members in their
  Scope) and Member (who sees only their own usage). One person can belong to
  several Orgs, answer invitations and start a new Org from the Org switcher.
- **Row-level security.** Authorisation lives in Postgres policies, so the
  same rules hold whether a query comes from the server or the browser.

## How it works

```
Claude Code ──hooks──▶ Collector ──HTTPS + API key──▶ /api/ingest ──▶ Postgres (RLS)
                           │
                           └── presigned PUT ──▶ S3-compatible bucket (transcripts)
```

The plugin's hooks read each transcript from a cursor and push only the new
Turns, so a typical turn costs a few hundred bytes. When the deployment cannot
be reached, reports wait in a local queue and are sent at the next session.
Transcripts go straight to storage through presigned URLs and never pass
through the application. The dashboard is Next.js. It reads Postgres through a
role that owns nothing, so every query goes through the policies. Sign-in uses
Supabase Auth.

## Quick start

### Use the hosted version

[sessclone.com](https://sessclone.com) runs this repository. The paid hosted
tiers are on a waitlist for now; the site has the details.

### Install the Collector

In Claude Code:

```
/plugin marketplace add NotTahaAli/sessclone
/plugin install sessclone@sessclone
```

Enabling the plugin asks for two things: the deployment URL and an API key from
the dashboard under **Keys**. Then restart Claude Code, because hooks take
effect only after a restart. [The install guide](https://sessclone.com/docs/install) covers
checking that it worked, exporting the settings as environment variables
instead, and setting it up in Claude Code cloud environments.

### Self-host it

Self-hosting is free at any size. You supply a Postgres 16+ cluster, an
S3-compatible bucket (optional; without one, archival is off) and a Supabase
project for sign-in. [The self-hosting guide](https://sessclone.com/docs/self-hosting) goes from a
clone to the first collected Turn: the database roles, the migrations, a script
that checks your bucket, `compose.yaml`, and scheduling the retention sweep.
[Configuration](https://sessclone.com/docs/configuration) lists every environment
variable, and [`.env.example`](.env.example) is the same list in copyable form.

## Development

Node and pnpm versions are pinned in `.nvmrc` and in the root `package.json`.
Dependency versions are pinned in the `catalog` of `pnpm-workspace.yaml`, except
for a few that are pinned directly in `apps/web/package.json`.

```bash
pnpm install
pnpm lint          # oxlint, type-aware
pnpm typecheck     # tsc across every package
pnpm test          # vitest, every suite
pnpm test:db       # the web project only: routes, schema and policies, against Postgres
pnpm format        # prettier --check
pnpm format:write  # prettier --write
```

To run the dashboard locally, copy `.env.example` to `apps/web/.env` (Next.js
reads that file, not one at the repo root), fill it in, and run:

```bash
pnpm --filter web dev
```

### The database

Route and policy tests run against a real Postgres, with every migration in
`supabase/migrations/` applied to an empty database, so you need a Postgres
server you can reach. Create two roles:

```bash
sudo -u postgres psql -c "create role sessclone login superuser password 'sessclone'"
sudo -u postgres psql -c "create role sessclone_app login password 'sessclone_app'"
sudo -u postgres createdb sessclone_test --owner sessclone
```

`sessclone` owns the tables, applies the migrations and seeds the fixtures. It
is a superuser only because `schema.test.ts` has to create a probe role and
switch into it, which nothing short of a superuser can do. CI's Postgres
container gives the same role the same privilege. A deployment does not need
this: see [`supabase/README.md`](supabase/README.md).

Because it owns the tables, `sessclone` bypasses every policy. `sessclone_app`
owns nothing, and it is the role the dashboard connects as
([ADR 0007](docs/adr/0007-dashboard-read-path.md)). That makes it the only
connection on which a policy test proves anything.

`DATABASE_URL` and `APP_DATABASE_URL` override the defaults,
`postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test` and
`postgres://sessclone_app:sessclone_app@127.0.0.1:5432/sessclone_test`.

`apps/web/test/harness.ts` is the test harness those suites share. It applies
the migrations once per run and empties the database between tests. Its
`seedFixture()` creates two Orgs with a person in every Role, including one
Manager with a Scope and one without.

The browser flows live in `apps/web/e2e/` and run with
`pnpm --filter web e2e` against a database named `sessclone_e2e_test` (or the
`DATABASE_URL`/`APP_DATABASE_URL` you pass). Install Chromium once with
`pnpm --filter web exec playwright install chromium`. The run starts
`next dev` itself, seeds through the database, and signs in without a Supabase
project: `apps/web/e2e/global-setup.ts` serves the JWKS endpoint the app
verifies against.

## Repository layout

| Path                         | What lives there                                                      |
| ---------------------------- | --------------------------------------------------------------------- |
| `apps/web`                   | The dashboard, the ingest API and the marketing site (Next.js)        |
| `packages/plugin`            | The Collector, a Claude Code plugin (MIT)                             |
| `packages/shared`            | Transcript parsing, Turn identity and the ingest schema, used by both |
| `supabase`                   | SQL migrations and the RLS policies                                   |
| `docs`                       | Install, self-hosting, configuration, ADRs, design notes, findings    |
| `scripts`                    | Repo tooling, including `verify-collector.mjs` for a Member's machine |
| `.claude-plugin`             | The marketplace manifest that `/plugin marketplace add` reads         |
| `compose.yaml`, `Dockerfile` | Running the app in a container                                        |
| `.scratch`, `docs/tickets`   | The issue tracker and its ticket graph, kept public                   |
| `AGENTS.md`, `CONTEXT.md`    | Working rules for coding agents, and the domain glossary              |

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before you open a pull request.
Contributions are accepted under AGPL-3.0-only plus the additional term in
`NOTICE.md`. Every commit needs a DCO sign-off (`git commit -s`), and there is
no CLA. Everyone taking part agrees to the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). To get help, see
[`SUPPORT.md`](SUPPORT.md).

**Security issues:** report them privately as described in
[`SECURITY.md`](SECURITY.md), not in a public issue.

## Licence

Copyright (c) 2026 sessclone contributors.

SessClone is licensed under **[AGPL-3.0-only](LICENSE)** together with **one
additional term under AGPL section 7(b)**, which is set out in
[`NOTICE.md`](NOTICE.md). The term: a deployment must keep the panel's
Appropriate Legal Notices visible (the copyright, the no-warranty statement,
the licence and how to read it), along with the SessClone credit shown beside
them. `LICENSE` is the unmodified licence text. `NOTICE.md` states the term and
explains what the marketing site's three self-hosting promises mean in
practice. If you run a modified copy as a network service, you must offer its
users the source.

`packages/plugin` is **MIT**, under its own
[`packages/plugin/LICENSE`](packages/plugin/LICENSE). The Collector runs on each
Member's own machine and gets vendored into other people's setups, where a
copyleft licence would only make it harder to install.
