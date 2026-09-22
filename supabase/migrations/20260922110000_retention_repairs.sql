-- Ticket 61, after review. Three holes in the retention story, all of them
-- about a transcript nobody can reach or account for.
--
-- **Upgrading an existing deployment sets every Org to 90 days**, because
-- `20260922100000_org_retention.sql` added the column with that default and
-- `alter table` fires no trigger. The first `POST /api/retention/sweep` then
-- destroys every transcript older than 90 days across every Org, and nobody
-- chose that. Raise it first if that is wrong for a deployment:
--
--     update orgs set retention_days = 365;
--
-- Nothing is destroyed until the sweep is called, and the sweep needs
-- `RETENTION_SWEEP_SECRET` set, so a deployment that does nothing keeps
-- everything.

-- 1. When the window starts.
--
-- The sweep measured `uploaded_at`, which the confirm route sets on every
-- upsert (ADR 0003's growing Session, a resumed Session, a Project change).
-- A transcript that keeps being re-uploaded therefore kept resetting its own
-- clock and could outlive any window — which is the wrong anchor for
-- something an Org states as a policy. `created_at` is written once and left
-- alone by the upsert, so the window is days since the transcript was first
-- stored.
alter table log_artifacts
  add column created_at timestamptz not null default now();

comment on column log_artifacts.created_at is
  'When this transcript was first stored. Retention measures from here; '
  'uploaded_at moves every time the object is replaced.';

-- Existing rows have only one timestamp to go on, and it is the honest one:
-- before this migration a re-upload was all the history there was.
update log_artifacts set created_at = uploaded_at;

-- The sweep reads `(org_id, created_at)`, so it gets its own index rather than
-- leaning on the `uploaded_at` one and sorting.
create index log_artifacts_org_created_at_idx
  on log_artifacts (org_id, created_at);

-- 2. Objects with no row to name them.
--
-- `POST /api/logs/confirm` deletes the object a Session left behind when its
-- Project changed mid-run, and that delete can fail — a bucket blip, a rotated
-- credential. The row has already moved to the new key by then, so nothing
-- names the old object and no sweep can reach it: a transcript, which is
-- source code and sometimes a credential, kept forever. Recorded here instead
-- and deleted by the next sweep.
create table storage_orphans (
  storage_key text primary key,
  noticed_at timestamptz not null default now()
);

comment on table storage_orphans is
  'Stored objects no log_artifacts row names. The retention sweep deletes '
  'them. Written by the ingest role only; no policy, so nothing the browser '
  'reaches can read or write it.';

-- Written by the ingest role and deleted by the sweep, as `turns` and
-- `log_artifacts` are (ADR 0001) — so no insert, update or delete policy.
-- Readable by the deployment's operator, because "are there objects nothing
-- names" is their question about their own bucket, and by nobody else: it
-- names storage keys, which carry an Org id, a Member id and a Project.
alter table storage_orphans enable row level security;

grant select on storage_orphans to sessclone_app;

create policy storage_orphans_read on storage_orphans for select
  using ((select sessclone_is_platform_admin()));

-- 3. Whether retention is running at all.
--
-- Retention needs a scheduler the deployment supplies, so "removed past the
-- window" is a promise only a sweep keeps. One row, so an Owner reading the
-- setting can be told that no sweep has ever run here rather than being shown
-- a guarantee nothing is providing.
create table retention_sweeps (
  id boolean primary key default true check (id),
  swept_at timestamptz not null default now(),
  removed integer not null default 0
);

comment on table retention_sweeps is
  'The last retention sweep on this deployment: one row, replaced each time. '
  'The dashboard reads it to say whether retention is being enforced.';

alter table retention_sweeps enable row level security;

-- Read-only to the dashboard: the sweep writes as the ingest role.
grant select on retention_sweeps to sessclone_app;

-- Readable by anybody signed in: it is one timestamp about the deployment,
-- and every Org settings page states it so an Owner can tell whether the
-- window they set is enforced. It names no Org, no Member and no transcript.
create policy retention_sweeps_read on retention_sweeps for select
  using ((select sessclone_user_id()) is not null);
