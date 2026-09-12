# 25: Postgres-backed test harness

**What to build:** The rig every database-touching test uses, so no later ticket has to invent one: a real Postgres in CI with migrations applied and a seeded fixture covering each Role.

**Blocked by:** 01, 21.

**Status:** ready-for-agent

- [ ] CI starts a real Postgres and applies the real migrations
- [ ] A seed fixture creating two Orgs, and a member in each Role including a Manager with and without a Scope
- [ ] SQL-level tests runnable as a distinct suite, as each Role
- [ ] Database reset between tests, so order does not matter
