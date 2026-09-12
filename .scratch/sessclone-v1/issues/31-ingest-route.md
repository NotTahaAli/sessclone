# 31: Ingest route

**What to build:** The endpoint the Collector reports to. Sending the same Turns twice leaves one row; malformed input is refused before anything is written.

**Blocked by:** 22, 25, 29, 30.

**Status:** ready-for-agent

- [ ] Payload validated against the shared schema before any write
- [ ] Turns written idempotently; the same payload twice leaves one row each
- [ ] Response carries the position the Collector needs to advance its cursor
- [ ] Devices and Projects resolved or created from the normalised keys
- [ ] Establishes the route test suite; later tickets extend it
