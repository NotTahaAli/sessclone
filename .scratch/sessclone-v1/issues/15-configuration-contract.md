# 15: Configuration contract

**What to build:** The full list of environment variables the server and the Collector read, so a self-hoster can stand the product up without reading source.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Every variable named, with its default and whether it is required
- [x] Database, storage, and base URL all configurable; no provider hard-coded
- [x] Collector-side variables documented alongside server ones
- [x] An example environment file committed, carrying no real values

**Answer:** `docs/configuration.md` is the contract and `.env.example` is the
copyable form of it. Server and Collector variables are listed together, each
with its default and whether it is required, and the three values that are
deliberately _not_ environment variables — Rates, Tiers and Retention, the Org
timezone — are named so nobody goes looking. Database, storage, and the public
base URL are all plain configuration: Postgres by URL, storage by S3 endpoint,
no provider in any code path. `packages/shared/src/configuration.test.ts` fails
when the doc and the example file disagree — on a variable's presence or on its
default — which is the only failure mode a self-hoster would otherwise meet at
runtime on their own deployment.

Both files say plainly that only `DATABASE_URL` and `SESSCLONE_URL` are read by
code today and name the ticket that wires each of the rest, because a contract
that reads as present tense while describing a future is worse than no contract:
it has a self-hoster filling in credentials nothing consumes.
