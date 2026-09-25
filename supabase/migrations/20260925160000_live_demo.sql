-- Ticket 137: the read-only live demo.
--
-- The demo's two Orgs are ordinary Orgs holding generated data (Taha,
-- 2026-09-25), marked so that nothing counting real customers counts them:
-- the Admin panel's Org list and pending count, the Tier page's Org counts,
-- and ingest, which refuses a demo Org's keys outright.
--
-- No new table, so no new policy. The visitor reads through the same policies
-- as anybody (ADR 0001); what makes the demo read-only is `asViewer` opening
-- each of the visitor's transactions `read only`, which Postgres enforces on
-- every write whichever action forgot to check.

alter table orgs add column is_demo boolean not null default false;

comment on column orgs.is_demo is
  'A demo Org (ticket 137): generated data, refreshed daily by '
  '/api/demo/refresh, left out of the Admin panel and refused by ingest. Set '
  'only by the owning role; the dashboard role can neither set nor clear it.';

-- `sessclone_app` holds a table-wide insert and update grant on `orgs`
-- (`orgs_create`, `orgs_write`), so a column grant cannot keep it off this
-- column: an Owner could hide their own Org from the operator by marking it a
-- demo. The guard refuses any change to the flag unless the table's owner is
-- making it — the refresh route, on the ingest connection — the same test
-- `sessclone_guard_invitation_columns` makes.
create or replace function sessclone_guard_org_demo() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.is_demo is distinct from
       (case when tg_op = 'INSERT' then false else old.is_demo end)
     and current_user is distinct from (
       select pg_get_userbyid(relowner) from pg_class where oid = tg_relid) then
    raise exception 'only the deployment marks an Org as a demo'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger orgs_guard_demo
  before insert or update of is_demo on orgs
  for each row execute function sessclone_guard_org_demo();
