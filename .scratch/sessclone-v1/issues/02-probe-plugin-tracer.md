# 02: Probe plugin tracer

**What to build:** The riskiest mechanic in the product, proven before anything is built on it: a throwaway plugin whose `Stop` hook posts a hard-coded row to a route that stores it. Demonstrates that hook registration works and that the round trip closes.

**Blocked by:** 01.

**Status:** done

- [x] Plugin registers hooks through the manifest pointer, confirmed by the plugin details command reporting a non-zero hook count
- [x] Installing, restarting, and completing one turn leaves exactly one row
- [x] Carries its own throwaway migration, superseded by ticket 22
- [x] Findings note records what had to be true for the hook to fire
