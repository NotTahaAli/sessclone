-- Tickets 105-107: a person's saved transcript-viewer presets.
--
-- A preset is which entry categories the viewer shows plus how thinking is
-- drawn. It belongs to the person rather than to a membership: the same eyes
-- read transcripts in every Org they belong to, so `user_id` and no `org_id`.
--
-- The category list mirrors `CATEGORIES` in
-- `packages/shared/src/transcript/types.ts`. The check is a subset test
-- (`<@`), so a category the app stops offering fails new writes rather than
-- corrupting old rows; adding one to the app means replacing this constraint.
create table transcript_view_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  categories text[] not null check (
    categories <@ array[
      'user', 'assistant', 'tool', 'tool_output', 'skill', 'agent', 'workflow',
      'hook', 'hook_failed', 'section', 'compaction', 'interrupt', 'api_error',
      'slash_command', 'injected', 'attachment', 'queue', 'unknown'
    ]::text[]
  ),
  thinking text not null check (thinking in ('hidden', 'collapsed', 'verbose')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  -- The save action upserts on this, and it is also the index every read by
  -- `user_id` uses.
  unique (user_id, name)
);

-- At most one default per person. A unique index is checked row by row, not
-- at statement end, so `setDefaultPreset` clears the old default before it
-- sets the new one, in two statements of one transaction.
create unique index transcript_view_presets_one_default
  on transcript_view_presets (user_id) where is_default;

alter table transcript_view_presets enable row level security;

-- Nobody else's, in either direction: no Owner or Admin reach, because a
-- preset says nothing about the Org's data and everything about one reader.
create policy transcript_view_presets_own on transcript_view_presets for all
  using (user_id = (select sessclone_user_id()))
  with check (user_id = (select sessclone_user_id()));

-- Only the dashboard's role. `anon` and `authenticated` get nothing: the Data
-- API is off (ADR 0007), and a grant here would be a second door to keep shut.
grant select, insert, update, delete on transcript_view_presets to sessclone_app;
