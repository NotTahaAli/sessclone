-- Taha, 2026-09-23: "allow to mark failed as Viewed".
--
-- The Costs view pill counts failed Sessions in the period. Once somebody has
-- looked at one, it should stop asking for their attention while staying on
-- the failures list as the failure it was. Per viewer rather than Org-wide:
-- each person clears their own count, and one Admin's glance does not mark a
-- failure seen for the Owner.
--
-- A row is one person having seen one Session's failures up to `viewed_at`.
-- A failure after that time is new and counts again. The Session is the
-- `(member_id, session_id)` pair every other table keys it by (ticket 86):
-- `member_id` is whose Session it is, `viewer_member_id` who looked.
--
-- Additive only: a new table, its policies and its grant, and nothing that
-- existing code reads. It is safe to apply before the code that uses it.
-- No function is added, so there is no `search_path` to pin and nothing for
-- `20260923180000_definer_execute.sql`'s revoke to cover.
create table failure_views (
  org_id uuid not null references orgs (id) on delete cascade,
  viewer_member_id uuid not null,
  member_id uuid not null,
  session_id text not null check (length(btrim(session_id)) > 0),
  viewed_at timestamptz not null default now(),
  -- The count's anti-join probes exactly this, viewer first.
  primary key (viewer_member_id, member_id, session_id),
  foreign key (org_id, viewer_member_id)
    references members (org_id, id) on delete cascade,
  foreign key (org_id, member_id)
    references members (org_id, id) on delete cascade
);

alter table failure_views enable row level security;

-- Your own rows, in both directions, and only for a Session you can read:
-- `sessclone_visible_member_ids()` is the rule `session_events_read` and
-- `turns_read` use, so a Member cannot leave a mark on (or probe for) an
-- Admin's Session, and a Manager only on their Scope's.
create policy failure_views_own_read on failure_views for select
  using (viewer_member_id in (select sessclone_own_member_ids()));

create policy failure_views_own_insert on failure_views for insert
  with check (
    viewer_member_id in (select sessclone_own_member_ids())
    and member_id in (select sessclone_visible_member_ids())
  );

create policy failure_views_own_update on failure_views for update
  using (viewer_member_id in (select sessclone_own_member_ids()))
  with check (
    viewer_member_id in (select sessclone_own_member_ids())
    and member_id in (select sessclone_visible_member_ids())
  );

grant select, insert, update on failure_views to sessclone_app;
