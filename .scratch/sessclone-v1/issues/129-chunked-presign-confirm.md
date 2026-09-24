# 129: Presign and confirm accept chunks

**What to build:** The deployment side of ADR 0008. A Collector that asks for `layout: 'chunked'` is told how much is already sealed and gets URLs for its new chunks and its tail. The confirm records those chunks and moves the tail in one transaction. Older Collectors are unaffected.

**Where the ask forks, and what was picked.**

- Contract in `packages/shared/src/presign.ts`. Every addition is optional or defaulted, so older Collectors and older deployments keep the whole-file path:
  - The request gains `layout` (`whole` by default) and `seal` (1 to 16 planned `{ seq, sha256 }`, chunked only; review fix: the chunk keys are content-addressed from those hashes, and each pass's tail key carries a random nonce, so no key is reused for different bytes).
  - The allowed answer echoes `layout: 'chunked'` and adds `sealed: { bytes, sha256, chunks }` and `seals[]`.
  - The confirm gains `layout`, `chunks[] { seq, rawOffset, rawLength, sha256 }` and `sealedSha256`.
  - There is one new transient refusal, `stale_chunks`.
- `artifactKey` learns the chunk and tail keys from ADR 0008. The tail with zero chunks stays `…/<session>.jsonl`. Only `kind = 'transcript'` may chunk; any other kind with `layout: 'chunked'` is answered as `whole`.
- Tier, `archival_off`, `project_excluded`, `no_turns` and the whole-file `unchanged` guard are checked before anything chunk-related and do not change.
- The confirm serialises on the transcript's identity (a transaction-scoped advisory lock, since a first upload has no row to lock; ADR 0008 updated), checks that the new chunks follow on from `sealed_bytes` and the next seq, and HEADs every new chunk plus the tail in parallel (at most 17) for `stored_bytes` and the tail's raw size. Then, in one transaction, it inserts the chunk rows and updates `storage_key`, `size_bytes`, `sha256`, `sealed_bytes` and `sealed_sha256`. The old tail is deleted after commit through the existing replaced-key path, including its `storage_orphans` fallback.
- `layout: 'whole'`, which includes every older Collector's confirm, deletes the row's chunk rows in the same statement as the upsert. Their objects go after commit, and a failed delete lands in `storage_orphans`.
- Review fix: the presign records every key it signs in `log_upload_pending`; the confirm deletes the keys it records from it in its transaction (refusing `not_uploaded` when one is gone), and a stale, refused or `unchanged` confirm queues that pass's pending keys into `storage_orphans`.
- Review fix: `rawLength` is capped at 256 MiB and `rawOffset` below 2^50 in the contract, and the confirm refuses (400) a chunk whose `rawLength` is more than 1032 times its HEAD-read stored size.
- A Session that moved Project (`stale_key`) starts chunking again from zero under its new prefix. The old chunks go with the replaced row.

**Blocked by:** 128

**Status:** done

- [x] Zod contract unit tests: an old request still parses with defaults; `seal` without `chunked` is refused; `seal` over 16 is refused
- [x] `apps/web/test/presign.test.ts` and `confirm.test.ts` against real Postgres, with storage mocked as today:
  - a steady-state tail confirm
  - a sealing confirm that writes the chunk rows and moves the tail key
  - a non-contiguous chunk list refused as `stale_chunks`
  - `whole` clearing the chunks and handing their keys to `deleteObjects`
  - an old-shape request behaving exactly as before
  - `unchanged` still short-circuiting
  - sizes coming from the HEAD, never from the body
- [x] Two claims verified red: trusting a Collector-reported `stored_bytes`, and a `whole` confirm leaving chunk rows behind
- [x] ADR 0003's key section points to ADR 0008
