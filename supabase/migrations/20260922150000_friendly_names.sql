-- Tickets 90 and 91: a name for a Project, a name for a Session, and a name
-- for a person.
--
-- A Device has had one since ticket 57 and nothing else does, so a Project
-- reads as `local:vm:/home/user`, a Session as a uuid, and a person as an
-- email address. None of those is a bad identity; all three are bad labels.
--
-- Nothing here is identity. Every key stays the key, stays what the
-- breakdowns group on, and stays visible beside the name — renaming a Project
-- must not move a dollar, and two people called "Taha" must still be two
-- people.

-- --- A Project's name (ticket 90) ---------------------------------------
--
-- Org-wide and singular, because a Project is Org-scoped so that one
-- repository cloned by four Members is one Project (ticket 22). A per-Member
-- name would undo that at the display layer: the same row would be two things
-- in two people's Costs, and the two would rank against each other.
alter table projects add column nickname text
  constraint projects_nickname_check
    check (nickname is null or (btrim(nickname) <> '' and length(nickname) <= 60));

-- `projects` had no update policy and `sessclone_app` no write grant on it,
-- which `20260920120200_app_role.sql` calls a second lock — "a table with no
-- policy for a verb is not merely unmatched, it is unreachable". Both open
-- here, for one column, and the trigger below is what keeps the rest shut.
--
-- Owner or Admin, as every Org-wide setting is (tickets 49, 50, 61). A
-- Manager's Scope is a set of people, not of repositories, so it says nothing
-- about who may name one.
create policy projects_rename on projects for update
  using (org_id in (select sessclone_admin_org_ids()))
  with check (org_id in (select sessclone_admin_org_ids()));

grant update on projects to sessclone_app;                  -- projects_rename

-- The shape `devices` already has. A policy grants a whole row, and a row is
-- every column on it: without this an Admin could re-point a Project at
-- another Org's key, rewrite the remote a key is explained by, or backdate the
-- provenance the Collector wrote.
--
-- `last_seen_at` carries the same claim test its counterpart on `devices`
-- does: ingest moves it on every report, writing as the owning role with no
-- claim set (ADR 0001), while every write from the dashboard carries one.
create function sessclone_guard_project_columns() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.key is distinct from old.key
     or new.remote is distinct from old.remote
     or new.first_seen_at is distinct from old.first_seen_at then
    raise exception 'only the nickname is the org''s to change';
  end if;

  if new.last_seen_at is distinct from old.last_seen_at
     and sessclone_user_id() is not null then
    raise exception 'only the nickname is the org''s to change';
  end if;

  return new;
end
$$;

create trigger projects_guard_columns
  before update on projects
  for each row execute function sessclone_guard_project_columns();

-- --- A Session's name (ticket 90) ---------------------------------------
--
-- A Session is not a table: it is the `(member_id, session_id)` pair every
-- Turn carries, and its Agent Runs report under the same pair (finding 74).
-- So the label is keyed on that pair and on nothing else — one label per
-- Session, covering its subagents, as the Session's own summary does.
--
-- `org_id` is on the row for the reason `member_project_archival` gives for
-- carrying it: without it a label could be filed against an Org the Member
-- does not belong to, which is a row nothing can legitimately produce.
--
-- No foreign key to `turns`: a Session is a grouping rather than a row, and
-- there is nothing to point at. A label for a session id that never arrives is
-- an orphan nobody reads, which is cheaper than the alternative — a label that
-- could only be written after the first Turn landed.
create table session_labels (
  org_id uuid not null references orgs (id) on delete restrict,
  member_id uuid not null,
  session_id text not null check (length(btrim(session_id)) > 0),
  label text not null
    check (btrim(label) <> '' and length(label) <= 60),
  updated_at timestamptz not null default now(),
  primary key (member_id, session_id),
  foreign key (org_id, member_id) references members (org_id, id) on delete cascade
);

alter table session_labels enable row level security;

-- Read follows the Session: whoever `turns_read` lets see the Turns sees the
-- name on them. Anything narrower would show an Owner a list of Sessions with
-- the names missing from exactly the rows they are allowed to read.
create policy session_labels_read on session_labels for select
  using (member_id in (select sessclone_visible_member_ids()));

-- Write is the Session's own Member, or an Owner or Admin of its Org. The
-- Member because it is their Session and the common case; the Org's
-- administrators because an Owner reviewing the month should not be locked
-- out of labelling what they are looking at. Deliberately not a Manager: a
-- Scope is a permission to read, and this writes something everyone else in
-- the Org then reads.
create policy session_labels_write on session_labels for all
  using (
    member_id in (select sessclone_own_member_ids())
    or org_id in (select sessclone_admin_org_ids())
  )
  with check (
    member_id in (select sessclone_own_member_ids())
    or org_id in (select sessclone_admin_org_ids())
  );

grant select on session_labels to sessclone_app;
grant insert, update, delete on session_labels to sessclone_app;

-- The read every Sessions list makes: a page of Sessions, one statement.
create index session_labels_org_idx on session_labels (org_id, session_id);

-- --- A person's name (ticket 91) ----------------------------------------
--
-- On `users` rather than on `members`: `users` is the row that is the person,
-- `members` is their place in an Org, and a name that changed between Orgs
-- would be two answers to "who is this".
--
-- No policy and no grant are added. `users_write_self` already governs this
-- column — the person's own row, and nobody else's — and `sessclone_app` was
-- granted update on `users` for it. The email stays: a name leads, an address
-- identifies, and a list of two people called "Taha" is a list you cannot act
-- on.
alter table users add column display_name text
  constraint users_display_name_check
    check (display_name is null
           or (btrim(display_name) <> '' and length(display_name) <= 60));
