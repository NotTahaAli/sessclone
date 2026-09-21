-- Ticket 50: an Org keeps an Owner.
--
-- Roles and removal are an Admin's to change, and `sessclone_guard_member_columns`
-- already says so. What nothing says yet is that the last Owner cannot be
-- demoted or removed — by an Admin, or by the Owner themselves. An Org with no
-- Owner has nobody who can reach its Tier (ticket 47 is Owner-only), and no
-- Role left that can promote one, so it is a state with no way out that does
-- not involve a Platform Admin and a SQL prompt.
--
-- A constraint trigger, deferred to the end of the statement, so that swapping
-- Owners in one statement — promote the new one, demote the old one — passes,
-- while ending a statement with no Owner does not.

create or replace function sessclone_org_owners(org uuid) returns integer
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select count(*)::integer from members
   where org_id = org and role = 'owner' and removed_at is null
$$;

create or replace function sessclone_guard_last_owner() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  -- Only when this row was an Owner and has stopped being one. Every other
  -- write — a Member renamed, a Manager removed, a new Admin — is none of this
  -- trigger's business and costs it nothing.
  if old.role = 'owner' and old.removed_at is null
     and (new.role <> 'owner' or new.removed_at is not null)
     and sessclone_org_owners(old.org_id) = 0 then
    raise exception 'an org keeps at least one owner'
      using hint = 'make somebody else an owner first';
  end if;
  return null;
end $$;

create constraint trigger members_guard_last_owner
  after update on members
  deferrable initially deferred
  for each row execute function sessclone_guard_last_owner();

grant execute on function sessclone_org_owners(uuid) to sessclone_app;
