# 0007 — The dashboard reads through the `postgres` driver, not PostgREST

**Status:** accepted · 2026-09-20 · ticket 20

## Context

ADR 0001 put every authorisation rule in row-level security, and said both the
browser and the server would reach those policies. The dashboard now has to
pick one path, and the two candidates differ in more than ergonomics.

The charts are SQL. Cost over time is a bucketed aggregate over `turns` joined
to the Rate in force when each Turn ran (ADR 0002); the Member breakdown is
five rows plus a rolled-up Other. Those are `date_trunc`, `sum`, `lateral` and
a window — the shape a query language is for. PostgREST answers them only
through database views or RPC functions written per chart, which puts half the
read path in migrations and the other half in TypeScript.

The heavier cost is deployment. Reading through PostgREST makes a Supabase-
shaped deployment mandatory, and `docs/configuration.md` is built on the
opposite promise: the database is a Postgres URL, storage is any S3-compatible
endpoint, and self-hosting (ticket 67) is a configuration exercise rather than
a fork. Auth is already named as the one exception. Making the entire read path
a second exception gives that argument away.

The migrations were written for the alternative. `sessclone_user_id()` reads
the claim rather than calling `auth.uid()`, and says so:

> Reading both, rather than calling `auth.uid()`, keeps these migrations
> applying to a plain Postgres — which is what CI and a self-hoster run, and
> what the route tests apply from empty.

## Decision

Supabase Auth owns sign-in and the session cookie. Every read goes through the
`postgres` driver already in `apps/web`, inside a transaction that sets the
viewer's JWT claims before the query, so the policies apply to the connection
exactly as they apply to a Supabase request.

The obvious failure is a read that forgets to set the claim: it runs with
`sessclone_user_id()` null, no policy matches, and the page quietly shows
nothing — or, on a connection that owns the tables, everything. That is
mitigated structurally rather than by discipline.

- **One function is the only way to obtain a connection.** It takes the
  verified session, opens a transaction, sets the claim on it, and runs the
  caller's query inside it. There is no exported path that returns a bare
  connection, so forgetting the claim is not a thing a page can express.
- **The claim is transaction-local.** A connection returned to the pool carries
  no identity, so a leaked claim cannot reach the next viewer's query.
- **The claim comes from the verified session, never from a request header.**
  A header is attacker-controllable; this is the same reasoning that keeps
  `NEXT_PUBLIC_APP_URL` out of `Host`.
- **The service role key stays where ADR 0001 put it** — ingest paths that have
  already verified an API key. It is not a fallback for a read this path makes
  awkward.

## Consequences

The chart queries are written once, in SQL, next to the aggregation they
perform, and they are testable the way `docs/configuration.md` already
describes: `apps/web/vitest.config.mts` points at a real Postgres with the real
migrations applied from empty, so a policy test and a chart test are the same
kind of test. Seam C in the spec covers both.

Self-hosters get a dashboard that runs against any Postgres. Supabase remains
the auth dependency and only the auth dependency.

The cost is that RLS enforcement now depends on the connection role, which
Postgres does not enforce for us: the policies are `enable row level security`
and not `force`, so a superuser or the role that owns the tables bypasses them
silently. The application must connect as a role that is neither — the same
care the service role key already demands, applied one layer lower.

Revisit if the dashboard grows realtime subscriptions the browser needs
directly, or if a surface appears that wants generated CRUD more than it wants
aggregates. Neither is in v1.
