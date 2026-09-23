-- Ticket 102: a name for an Org that only platform administrators see.
--
-- An Org names itself, and an Owner or an Admin may rename it (ticket 101,
-- which needs no migration: `orgs_write` already governs the column). What an
-- operator calls an Org is a different thing — "Acme (pilot, Sara's intro)" —
-- and must never reach the Org's own people.
--
-- Its own table rather than a column on `orgs`, for that reason: a policy
-- grants a whole row, and `orgs_read` hands every Member their Org's row, so a
-- column there would be readable by exactly the people it is hidden from. It
-- keeps `orgs` clean besides, as `subscriptions` does for the Tier.
--
-- One row per Org or none. Clearing the name deletes the row, so every surface
-- falls back to the Org's own name on absence and nothing stores a blank.
create table org_operator_names (
  org_id uuid primary key references orgs (id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  updated_at timestamptz not null default now()
);

alter table org_operator_names enable row level security;

-- Read and write alike are the platform administrator's, as `rates_write`
-- is: an Owner of the Org is not one, and reads nothing here.
create policy org_operator_names_admin on org_operator_names for all
  using ((select sessclone_is_platform_admin()))
  with check ((select sessclone_is_platform_admin()));

grant select, insert, update, delete on org_operator_names to sessclone_app;
