# 13: ADR — Subscription shape without a provider

**What to build:** A recorded decision on how billing is modelled before any payment rail exists.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] States the provider columns carried on a subscription and that they are nullable
- [ ] States that every activation, manual included, writes an event
- [ ] States that no adapter interface is built until a real provider shapes it
