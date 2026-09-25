# 128: Schema for chunked transcripts

**What to build:** Taha, 2026-09-24: an 18 MB cloud session sends 18 MB again after every turn (ticket 99). ADR 0008 splits a transcript into sealed gzip chunks plus a raw tail. This ticket adds the rows that record the chunks. Nothing writes to them yet.

**Where the ask forks, and what was picked.**

- New table `log_artifact_chunks (artifact_id, seq, raw_offset, raw_length, stored_bytes, sha256, storage_key, member_id)`, keyed on `(artifact_id, seq)`. `storage_key` is unique, and `unique (artifact_id, raw_offset)` rules out overlapping chunks. `member_id` is denormalised so each policy is a single indexed check.
- `artifact_id` references `log_artifacts` **`on delete no action`**, never `cascade`. A cascade would drop the chunk rows along with the keys of objects that hold source code, and nothing would delete those objects. With `no action`, a delete path that forgets the chunks fails with 23503.
- `log_artifacts` gains `sealed_bytes bigint not null default 0 check (>= 0)` and `sealed_sha256 text` (lowercase hex, null when there are no chunks). `size_bytes` keeps meaning raw bytes.
- The policies ship in the same migration and copy `log_artifacts`: `select` for `sessclone_visible_member_ids()`, `delete` for `sessclone_own_member_ids()`, no insert or update policy, `grant select, delete … to sessclone_app`. RLS is enabled, never forced. No new function. If one ever becomes necessary: `security definer` with `set search_path = public, pg_temp`.
- Existing rows need no backfill: zero chunks is the whole-file case (ADR 0008).

**Blocked by:** 104

**Status:** done

- [x] Migration `supabase/migrations/20260923203000_transcript_chunks.sql`, with a comment on the table and each new column
- [x] RLS test against real Postgres (`apps/web/test/rls.test.ts` pattern): a Manager outside Scope reads no chunk rows. An Admin reads them and cannot delete them. The owning Member deletes them.
- [x] Test against real Postgres: deleting a `log_artifacts` row that still has chunks fails with a 23503. Deleting both in one statement through a data-modifying CTE succeeds. Both directions are verified red.
- [ ] **Production: Taha runs the migration SQL before the deploy of 129/130.** The columns are additive and defaulted, so code still live in that window runs unchanged.
