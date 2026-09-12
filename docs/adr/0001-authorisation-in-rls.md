# 0001 — Authorisation lives in row-level security

**Status:** accepted · 2026-09-12 · ticket 11

## Context

Every read in this product is scoped by Role. An Owner and an Admin see the
whole Org, a Manager sees only the Members in their Scope, and a Member sees
only themselves. The same rows are reached two ways: the dashboard reads them
from the browser through Supabase, and route handlers read them on the server.

Two readers means two chances to write the rule, and a rule written twice
drifts. The failure is not theoretical — one forgotten `where member_id = ?` in
one handler shows an Org's spending to a Manager who was never scoped to it.

## Decision

The Role rules live in Postgres row-level security policies. Application code
carries no authorisation branch of its own.

- Both paths go through the same policies. The browser client and the server
  client differ only in how they authenticate; neither can read a row the
  policies do not grant.
- **A table ships with its policies in the same migration.** A migration that
  creates a table and leaves its policies to a later one has shipped a table
  readable by everyone in the window between them.
- The service role key bypasses policies, so it is confined to ingest paths
  that have already verified an API key by hash. It is never used in anything
  the browser can reach, never in a page or a client component, and never as a
  convenience to work around a policy that is inconvenient. A policy that
  blocks a legitimate read is a policy to fix, not to bypass.
- `is_platform_admin` is a flag on the user, not a Role. Policies that grant
  platform-wide access (Rates, Tiers, subscription activation) read the flag.
  An Org Owner must never reach global pricing.

## Consequences

Authorisation is testable as SQL: seed a database, connect as each Role, assert
what comes back. That is Seam C in the spec, and it tests the layer the rule
actually lives in, rather than testing an application's opinion about it.

The cost is that a policy bug is a migration rather than a patch, and that
policy debugging in Postgres is worse tooling than a stack trace. Accepted: the
alternative is scattering the same rule across every handler that ever reads
a scoped table.

Self-hosters get the same enforcement, because the rules travel in the
migrations rather than in a deployment's application code.
