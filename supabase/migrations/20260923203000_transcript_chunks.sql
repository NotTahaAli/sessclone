-- Ticket 128, ADR 0008: a growing transcript is stored as sealed gzip chunks
-- plus a raw tail, so a cloud turn sends its new bytes rather than the whole
-- Session again.
--
-- Additive only. The code still deployed when this runs never names the new
-- table or columns, and every existing row is already valid: zero chunks is
-- the whole-file case, whose tail is the object `storage_key` already names.
-- Nothing is backfilled.
--
-- One function is added, `sessclone_forget_pending`, and it pins
-- `search_path = public, pg_temp` as every `security definer` must.

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

-- Every key a presign has signed and no confirm has recorded yet (ADR 0008).
--
-- A pass cut off by its deadline or a crash, one that loses a race to
-- another pass, one refused at the confirm, and an upload whose confirm is
-- `unchanged` all leave objects that no row and no `storage_orphans` entry
-- names. The presign writes each key here before it answers; the confirm
-- deletes the keys it records in its own transaction, and queues a refused
-- pass's keys into `storage_orphans`; the retention sweep moves what has
-- expired there; and a Member's own delete takes what is pending under the
-- transcript it destroys.
--
-- No foreign key to `members`: a cascade would drop the only record of
-- these objects, and `no action` would block removing the Member. The sweep
-- reaches them by `expires_at` either way.
create table log_upload_pending (
  storage_key text primary key check (length(btrim(storage_key)) > 0),
  member_id uuid not null,
  session_id text not null,
  agent_id text,
  kind text not null
    check (kind in ('transcript', 'agent_meta', 'workflow_journal')),
  project_id uuid,
  expires_at timestamptz not null
);

comment on table log_upload_pending is
  'Object keys a presign signed that no confirm has recorded yet (ADR 0008). '
  'Written by the presign route; deleted by the confirm, the retention sweep '
  '(once expired, through storage_orphans) and the Member''s own deletes.';
comment on column log_upload_pending.storage_key is
  'The object key the presign signed a PUT URL for.';
comment on column log_upload_pending.member_id is
  'The Member whose API key asked for it; the only one a confirm or a delete '
  'may take it for.';
comment on column log_upload_pending.session_id is
  'The Session it belongs to, so a per-Session delete takes it.';
comment on column log_upload_pending.agent_id is
  'The Agent Run or workflow run, as on log_artifacts; null for the Session.';
comment on column log_upload_pending.kind is
  'As log_artifacts.kind.';
comment on column log_upload_pending.project_id is
  'The Project the presign resolved, so a per-Project delete takes it.';
comment on column log_upload_pending.expires_at is
  'Past the URL''s life plus a grace for a slow confirm. After this the '
  'retention sweep queues the key for deletion, and a confirm naming it is '
  'refused as not_uploaded.';

-- The per-Session and per-Project deletes lead on the Member; the sweep on
-- the expiry.
create index log_upload_pending_member_idx
  on log_upload_pending (member_id, session_id);
create index log_upload_pending_expires_idx
  on log_upload_pending (expires_at);

alter table log_upload_pending enable row level security;

-- The Member's own, for their own deletes, and nobody else's: the keys carry
-- an Org, a Member and a Project.
create policy log_upload_pending_read on log_upload_pending for select
  using (member_id in (select sessclone_own_member_ids()));

create policy log_upload_pending_delete on log_upload_pending for delete
  using (member_id in (select sessclone_own_member_ids()));

-- No insert or update policy: rows are written by the presign route on the
-- owning connection, after it has verified an API key.

grant select, delete on log_upload_pending to sessclone_app;

-- A key leaves the ledger unrecorded — a refused confirm, a Member's delete,
-- a pass's unused keys — while its PUT URL may still be live, so a late PUT
-- can land after the key was queued. The sweep deletes an orphan only once
-- `not_before` has passed, which is the pending entry's `expires_at`: after
-- the URL's life, so no PUT can land after the delete. Existing rows get
-- the migration's time and go as before.
alter table storage_orphans
  add column not_before timestamptz not null default now();

comment on column storage_orphans.not_before is
  'The sweep deletes the object no earlier than this: a key queued from '
  'log_upload_pending waits until its presigned PUT URL is dead (ADR 0008).';

-- A Member's own delete takes the uploads pending under what it destroys
-- and must queue them, and `storage_orphans` is the ingest role's alone:
-- `sessclone_app` may not read it, and an RLS insert policy could not raise
-- the `not_before` of a key already queued (on conflict do update needs a
-- read policy there). So this one narrow `security definer` does it: it
-- takes only the named keys pending for the caller's own Members, and
-- queues each no earlier than its URL's expiry.
create or replace function sessclone_forget_pending(keys text[])
  returns setof text
  language sql volatile security definer
  set search_path = public, pg_temp as $$
  with gone as (
    delete from log_upload_pending
     where storage_key = any(keys)
       and member_id in (select sessclone_own_member_ids())
    returning storage_key, expires_at
  ), queued as (
    insert into storage_orphans (storage_key, not_before)
    select storage_key, max(expires_at) from gone group by storage_key
    on conflict (storage_key) do update
       set not_before = greatest(storage_orphans.not_before,
                                 excluded.not_before)
  )
  select distinct storage_key from gone
$$;

revoke all on function sessclone_forget_pending(text[]) from public;
grant execute on function sessclone_forget_pending(text[]) to sessclone_app;
