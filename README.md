# sessclone

Claude Code usage and cost, for a whole team. Sessions from every device land
in one place, so an Org can see what it is spending, per member, per project,
per device — and download the raw session logs to learn from them.

## Getting started

```bash
pnpm install
pnpm lint        # oxlint, type-aware
pnpm typecheck   # tsc across every package
pnpm test        # vitest
pnpm format      # prettier --check
```

### The database

Route tests run against a real Postgres and apply `supabase/migrations/`
themselves, so a cluster has to be reachable:

```bash
sudo -u postgres psql -c "create role sessclone login password 'sessclone'"
sudo -u postgres createdb sessclone_test --owner sessclone
```

`DATABASE_URL` overrides the default,
`postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test`.

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

## Contributing

`AGENTS.md` is the contract — repo rules, the skills to reach for, and the bars
every change clears. `CONTEXT.md` is the domain glossary.
