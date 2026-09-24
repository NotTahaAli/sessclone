# 131: Collector sends only new bytes

**What to build:** `packages/plugin/src/archive.mjs` archives a growing transcript per ADR 0008. It verifies the sealed prefix the deployment reports, seals roughly 1 MiB chunks at line ends as gzip, and uploads only the tail. The result: a steady-state cloud turn sends at most about 1 MiB rather than the whole session.

**Where the ask forks, and what was picked.**

- **The deployment holds the cursor.** The Collector reads `sealed.bytes` and `sealed.sha256` from the presign answer, not from local state, because finding 74 showed a container can lose its state directory while the transcript carries on. `archived/` stays a cache, as it is today.
- **One pass, one read.**
  1. `stat` the file once.
  2. Hash the whole file for the `unchanged` guard, as today.
  3. Presign with `layout: 'chunked'`.
  4. Re-read `[0, size)` once. Use `hash.copy()` to check the prefix at `sealed.bytes`, and take the cumulative hash at each new cut.
  5. Pick cut points with a pure `sealPlan(bytes, from)`: the first `\n` at or after 1 MiB, never inside a line. Seal at most 16 chunks per pass, still inside the deadline.
  6. Only when there is something to seal: presign again with `seal: k`.
  7. PUT each chunk as `application/gzip` (`zlib` gzip, streamed), then PUT the tail raw, then confirm.
- **Failsafe to whole-file** when the file is shorter than `sealed.bytes`, when the prefix hash differs, when compression throws, or when the deployment does not echo `layout: 'chunked'` (it predates 129). The whole-file path is today's code, with `layout: 'whole'`.
- `stale_chunks` is transient, like `stale_key`: never settled, and asked again on the next pass. The per-Session lock from ticket 99 already stops two passes on one machine from racing.
- Sidecars (`agent_meta`, `workflow_journal`) stay whole-file. Agent Run transcripts chunk like the main one.
- Applies on every Device, not only in the cloud. A transcript under 1 MiB never seals, so it produces the same object and the same requests as today.

**Blocked by:** 129

**Status:** todo

- [x] Unit tests, in `archive.test.mjs` (vitest, as the rest of the plugin's tests are, rather than `node:test`):
  - `sealPlan`: exactly 1 MiB, a line longer than 1 MiB, no newline, the 16-chunk cap, a partial last line left in the tail
  - the prefix check: truncated, rewritten, and matching
  - gzip round-trip equals the raw bytes
- [x] `archive.test.mjs` against the fake deployment:
  - request order for a steady turn (presign, tail PUT, confirm) and for a sealing turn (presign, presign with `seal`, chunk PUTs, tail PUT, confirm)
  - bytes sent equal to the new bytes only
  - fallback to `whole` on each of the four triggers
  - an older deployment gets a whole file
  - verified red with the prefix check removed (two tests fail: the plan's prefix check and the truncated/rewritten fallback)
- [ ] Checked from a cloud container on production: after sealing, a later turn's bytes on the wire are about the size of the tail, and the dashboard download is byte-identical to the local file (`sha256sum`)
- [x] `docs/configuration.md` § archival says what is sent per turn
