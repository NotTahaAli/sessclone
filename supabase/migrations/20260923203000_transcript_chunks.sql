-- Ticket 128, ADR 0008: a growing transcript is stored as sealed gzip chunks
-- plus a raw tail, so a cloud turn sends its new bytes rather than the whole
-- Session again.
--
-- Additive only. The code still deployed when this runs never names the new
-- table or columns, and every existing row is already valid: zero chunks is
-- the whole-file case, whose tail is the object `storage_key` already names.
-- Nothing is backfilled.
--
-- No function is added or replaced, so no `search_path` pin is involved.

alter table log_artifacts
  add column sealed_bytes bigint not null default 0
    constraint log_artifacts_sealed_bytes_check check (sealed_bytes >= 0),
  add column sealed_sha256 text
    constraint log_artifacts_sealed_sha256_check
    check (sealed_sha256 ~ '^[0-9a-f]{64}$'),
  -- Null exactly when nothing is sealed, so a reader never has to decide
  -- which of the two to believe.
  add constraint log_artifacts_sealed_check
    check ((sealed_bytes = 0) = (sealed_sha256 is null)),
  -- The target of the chunks' key below, which is what pins a chunk's
  -- denormalised `member_id` to its artifact's.
  add constraint log_artifacts_id_member_key unique (id, member_id);

comment on column log_artifacts.sealed_bytes is
  'Raw bytes [0, sealed_bytes) of the transcript held in log_artifact_chunks '
  '(ADR 0008). 0 means no chunks: storage_key is the whole transcript.';
comment on column log_artifacts.sealed_sha256 is
  'Lowercase hex SHA-256 of the raw bytes [0, sealed_bytes); null when '
  'sealed_bytes is 0. The presign returns it so a Collector can check its '
  'local prefix before continuing from sealed_bytes.';
comment on column log_artifacts.size_bytes is
  'Raw bytes of the whole transcript (chunks plus tail), which is what a '
  'download yields. What the bucket holds is sum(stored_bytes) of the chunks '
  'plus the tail.';

create table log_artifact_chunks (
  artifact_id uuid not null,
  -- Denormalised so each policy is one indexed membership check, not a join.
  -- The composite key below keeps it equal to the artifact's.
  member_id uuid not null,
  seq integer not null check (seq >= 1),
  raw_offset bigint not null check (raw_offset >= 0),
  raw_length bigint not null check (raw_length > 0),
  stored_bytes bigint not null check (stored_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text not null unique check (length(btrim(storage_key)) > 0),
  primary key (artifact_id, seq),
  unique (artifact_id, raw_offset),
  -- `no action`, never `cascade`: a cascade would drop these rows, and with
  -- them the only record of objects that hold source code. A delete path
  -- that forgets the chunks fails with 23503 instead. `no action` is checked
  -- at the end of the statement, so a path that deletes chunks and artifact
  -- through data-modifying CTEs in one statement succeeds.
  foreign key (artifact_id, member_id)
    references log_artifacts (id, member_id) on delete no action
);

comment on table log_artifact_chunks is
  'Sealed, immutable gzip chunks of a transcript (ADR 0008). Written by the '
  'confirm route alone; deleted with their artifact in one statement.';
comment on column log_artifact_chunks.artifact_id is
  'The log_artifacts row (a transcript) this chunk belongs to.';
comment on column log_artifact_chunks.member_id is
  'The artifact''s member_id, copied so the policies need no join.';
comment on column log_artifact_chunks.seq is
  'Position in the transcript, from 1, contiguous.';
comment on column log_artifact_chunks.raw_offset is
  'Offset of the chunk''s first raw byte in the transcript.';
comment on column log_artifact_chunks.raw_length is
  'Raw (uncompressed) bytes in the chunk.';
comment on column log_artifact_chunks.stored_bytes is
  'Bytes the object holds, gzipped, as storage reported on a HEAD.';
comment on column log_artifact_chunks.sha256 is
  'Lowercase hex SHA-256 of the chunk''s raw bytes.';
comment on column log_artifact_chunks.storage_key is
  'The object key, …/<session>/chunks/<seq>-<hash>.jsonl.gz: content-'
  'addressed by the first 16 hex of sha256, so different bytes never share '
  'a key.';

create index log_artifact_chunks_member_idx on log_artifact_chunks (member_id);

alter table log_artifact_chunks enable row level security;

-- As `log_artifacts_read`: a chunk is part of its transcript.
create policy log_artifact_chunks_read on log_artifact_chunks for select
  using (member_id in (select sessclone_visible_member_ids()));

-- As `log_artifacts_delete`: the Member's own decision and nobody else's.
create policy log_artifact_chunks_delete on log_artifact_chunks for delete
  using (member_id in (select sessclone_own_member_ids()));

-- No insert or update policy: rows are written by the confirm route on the
-- owning connection, after it has verified an API key.

grant select, delete on log_artifact_chunks to sessclone_app;
