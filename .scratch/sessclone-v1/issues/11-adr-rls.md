# 11: ADR — Authorisation in RLS

**What to build:** A recorded decision that the Role rules live in Postgres policies rather than in application code.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] States that browser and server reads pass through the same policies
- [x] States that a table ships with its policies in the same migration
- [x] States where the service role may be used, and where it may never be
