# sessclone

Claude Code usage and cost, for a whole team. Sessions from every device land
in one place, so an Org can see what it is spending, per member, per project,
per device — and download the raw session logs to learn from them.

## Getting started

```bash
pnpm install
pnpm lint        # oxlint, type-aware
pnpm typecheck   # tsc across every package
pnpm test        # vitest, every suite
pnpm test:db     # the SQL suite only: schema and policies, against Postgres
pnpm format      # prettier --check
```

### The database

Route and policy tests run against a real Postgres with `supabase/migrations/`
applied from empty, so a cluster has to be reachable. Two roles, because the
second one is the point:

```bash
sudo -u postgres psql -c "create role sessclone login password 'sessclone'"
sudo -u postgres createdb sessclone_test --owner sessclone
sudo -u postgres psql -c "create role sessclone_app login password 'sessclone_app'"
```

`sessclone` owns the tables, applies the migrations and seeds the fixtures —
and, owning them, Postgres exempts it from every policy. `sessclone_app` owns
nothing and is what the dashboard connects as (ADR 0007), so it is the only
connection on which a policy test proves anything. The migration grants it what
it needs; it is created here because a migration must not invent a credential.

`DATABASE_URL` and `APP_DATABASE_URL` override the defaults,
`postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test` and
`postgres://sessclone_app:sessclone_app@127.0.0.1:5432/sessclone_test`.

`apps/web/test/harness.ts` is the rig those tests share: migrations apply once
per run, the database is emptied between tests so order does not matter, and
`seedFixture()` creates two Orgs with a person in every Role — including a
Manager with a Scope and one without.

### Configuration

`docs/configuration.md` names every environment variable the server and the
Collector will read, with its default and whether it is required.
`.env.example` is the same list, copyable, carrying no real values. Most are
not wired up yet — the doc marks which two are read today and names the ticket
that wires each of the rest.

Node and pnpm versions are pinned in `.nvmrc` and `package.json`; dependency
versions live once in the `catalog` of `pnpm-workspace.yaml`.

## Layout

| Path              | What lives there                               |
| ----------------- | ---------------------------------------------- |
| `apps/web`        | The dashboard and the marketing site (Next.js) |
| `packages/plugin` | The Collector: a Claude Code plugin            |
| `packages/shared` | Types and helpers both sides use               |
| `supabase`        | Migrations, RLS policies, local stack config   |

## Licence

Copyright (c) 2026 sessclone contributors.

The application is **AGPL-3.0-only** — the `LICENSE` at the repo root covers
everything except the one carve-out below. Run a modified copy as a network
service and you owe its users the source.

`packages/plugin` is **MIT**, under its own `packages/plugin/LICENSE`. The
Collector runs on a contributor's own machine and gets vendored into other
people's setups; copyleft there would be a tax on installing it, not a
protection.

One additional term rides with the AGPL, under its section 7(b): a deployment
keeps the "Powered by sessclone" credit visible in the panel. `NOTICE.md` is
where that term is written out, along with what the marketing site's three
self-hosting promises each actually are — two are licence conditions and the
third, sending features back as a pull request, is an ask that no open licence
enforces.

## Contributing

`CONTRIBUTING.md` covers the licence of what you send: AGPL-3.0-only, a DCO
sign-off (`git commit -s`), and no CLA.

`AGENTS.md` is the contract — repo rules, the skills to reach for, and the bars
every change clears. `CONTEXT.md` is the domain glossary.
