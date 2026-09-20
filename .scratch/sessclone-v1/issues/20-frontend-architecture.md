# 20: Frontend architecture decisions

**What to build:** The recorded choices every page then follows: routing, data fetching, state, and charting.

**Blocked by:** 01, 16.

**Status:** done

- [x] Server and client component boundaries stated
- [x] Data fetching and caching approach stated, including how reads pass through RLS as the signed-in user
- [x] Charting library chosen, current version verified from the registry, and pinned
- [x] Current framework documentation consulted rather than recalled

**Answer:** `docs/adr/0007-dashboard-read-path.md` records the one decision that
is hard to reverse, and `docs/design/frontend-architecture.md` records the rest.

Reads reach Postgres as the signed-in person rather than through PostgREST.
Supabase keeps sign-in and the session; a read opens a transaction, sets the
viewer's claims from the verified session, and runs the query, so the policies
apply. The migrations were written for exactly this — they read the JWT claim
rather than calling Supabase's own function, so a plain Postgres works, which is
the whole self-hosting argument — and the chart queries are SQL aggregates that
a generated query builder expresses badly. The risk is that a read forgets to
set the claim and runs with no policy applied, so the mitigation is structural:
one function is the only way to obtain a connection, it sets the claim itself,
and no exported path hands back a bare one.

Pages and layouts are Server Components and are where data is fetched. Each
chart is a client leaf taking rows as props: recharts 3.10.1 ships no
`"use client"` directive of its own, verified against the published package, so
it is imported from a module this repo marks. No caching flag, because every
read of Org data needs the session cookie and could not be cached anyway; the
thing that would change that is a public marketing surface living in this app.
Series colours are passed per element as CSS variables. The theme object the
recharts documentation site shows does exist at the pinned version, but it holds
only grid strokes and is marked experimental in its own types, so it buys
nothing here.

No new test infrastructure. Aggregation and formatting stay in
`packages/shared`, where the fast suites already run; route and policy tests
keep running against real Postgres; rendered surfaces are covered by the
screenshot pass this repo already requires. Next's own documentation rules out
unit-testing async Server Components, which is most of what this app is.

One thing found while verifying and recorded in the ADR's consequences rather
than fixed here: the migrations enable row-level security but never force it,
and Postgres does not apply policies to the role that owns the tables. The
connection function must therefore use a role that neither owns the tables nor
is a superuser, or the tables need forcing — otherwise a policy test can pass
while enforcing nothing. That belongs to the tickets that own the schema.
