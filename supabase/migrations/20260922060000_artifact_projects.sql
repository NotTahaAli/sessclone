-- Ticket 73: a Member can name the Projects their stored transcripts belong to.
--
-- `sessclone_visible_project_ids()` had two branches: every Project of an Org
-- you administer, and every Project you have a Turn on. A stored transcript is
-- a third way a Project becomes yours, and it was missing — so a Member whose
-- Turns had not landed (or had been filtered out of their Scope) saw their own
-- archived Sessions grouped under "No repository", and the deletion page could
-- not tell one Project's transcripts from another's.
--
-- The branch mirrors the `turns` one exactly, down to
-- `sessclone_visible_member_ids()`: whoever may read the artifact may read the
-- name of the Project it came from, and nobody else. It adds no row that was
-- not already visible through `log_artifacts_read`.
--
-- The `search_path` is pinned here as ...120600_search_path.sql pinned it.
-- `create or replace function` keeps the old `SET` clause only if the new
-- definition carries none; this one does, so it must carry the whole pin, and
-- `pg_temp` must be named. Postgres searches `pg_temp` first for tables unless
-- the path names it, and every role may create temp tables — an unpinned
-- helper reads a forged `projects` or `turns` planted by any signed-in user.
create or replace function sessclone_visible_project_ids() returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select id from projects where org_id in (select sessclone_admin_org_ids())
  union
  select distinct project_id from turns
   where member_id in (select sessclone_visible_member_ids())
     and project_id is not null
  union
  select distinct project_id from log_artifacts
   where member_id in (select sessclone_visible_member_ids())
     and project_id is not null
$$;
