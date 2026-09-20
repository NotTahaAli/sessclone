# 25: Postgres-backed test harness

**What to build:** The rig every database-touching test uses, so no later ticket has to invent one: a real Postgres in CI with migrations applied and a seeded fixture covering each Role.

**Blocked by:** 01, 21.

**Status:** done

- [x] CI starts a real Postgres and applies the real migrations
- [x] A seed fixture creating two Orgs, and a member in each Role including a Manager with and without a Scope
- [x] SQL-level tests runnable as a distinct suite, as each Role
- [x] Database reset between tests, so order does not matter

**Answer:** `apps/web/test/harness.ts`, with `global-setup.ts` and `setup.ts` beside it.

Migrations apply once per run in `globalSetup`, and every test starts from an
empty database because `setupFiles` truncates between tests — discovered from
the catalogue, so a migration that adds a table needs no edit here. Three files
previously carried their own copy of "drop the schema and apply every
migration", which raced and left cross-`describe` ordering dependencies; all
three now use the rig, and the ad-hoc `sessclone_rls_probe` role is gone in
favour of `sessclone_app`, the role the dashboard actually connects as.

`seedFixture()` creates two Orgs, each with a person in every Role including a
Manager with a Scope and a Manager without one, plus a removed Member, a
Platform Admin outside every Org and a signed-in stranger who belongs to
nothing. `asRole(org, role, query)` runs a query as one of them, inside a
transaction with their claim set — the same path ADR 0007 gives the dashboard.

The SQL suite runs on its own with `pnpm test:db`. CI already starts a real
Postgres and creates `sessclone_app`; `README.md` documents both roles and the
harness.
