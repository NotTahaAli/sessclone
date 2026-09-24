# 130: Retention and deletion take a transcript's chunks

**What to build:** Every path that deletes a `log_artifacts` row also deletes its chunk rows in the same statement, and hands the chunk keys to `deleteObjects` alongside the tail. Once ticket 128's `no action` foreign key is in place, a path that forgets fails loudly instead of leaving the chunks in the bucket.

**Where the ask forks, and what was picked.**

- There are three sites: `sweepRetention` in `lib/retention.ts`, and `deleteStoredSession` and `deleteStoredProject` in `lib/artifacts.ts`. Each already deletes rows with a data-modifying CTE and `returning storage_key`. Each gains a sibling CTE that deletes `log_artifact_chunks` for the doomed artifact ids and returns their keys. The union of keys goes to the existing `deleteObjects` call. The same rule as today holds: rows are deleted inside the transaction, objects next, commit last.
- Retention measures age from the artifact's `created_at`, so all of a transcript's chunks and its tail expire together. Chunks never expire one by one.
- `SWEEP_LIMIT` still counts artifacts. A chunked artifact contributes one key per MiB, and `deleteObjects` already sends them in batches of 1000.
- The transcripts page's "Stored" size and every `sum(size_bytes)` stay raw bytes (ADR 0008). No query changes here.

**Blocked by:** 128

**Status:** todo

- [ ] `apps/web/test/retention.test.ts`, `artifact-action.test.ts` and `artifacts.test.ts` against real Postgres: a chunked transcript's chunk keys, its tail key and its sidecars all reach `deleteObjects`, and no chunk row is left behind. A storage failure rolls back artifact rows and chunk rows together.
- [ ] Retention with a chunked backlog stays index-backed. `explain analyze` at the ticket-61 scale goes in the commit message.
