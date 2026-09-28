-- Deleting an Org still waiting for approval (Taha's picks, 2026-09-28).
--
-- Which: waiting means what the Admin panel counts as waiting, `inactive` or
-- no subscription row at all. A cancelled Org was approved once and keeps its
-- history, so it stays.
--
-- Who: an Owner of that Org, or a platform admin from the Admin panel. An
-- Owner in their deletion grace does not count, as nowhere else does.
--
-- What: the row goes for real, and with it everything that cascades from it —
-- memberships, invitations, the plan asked for and its events. A waiting Org
-- cannot make a key, so it has no Turns. One that does (an Org set back to
-- `inactive` after it ran) is refused by the `on delete restrict` keys that
-- guard Turns, devices and transcripts: billing history is never deleted.
--
-- Returns false for an Org the caller may not delete or that does not exist,
-- so a caller learns nothing about Orgs that are not theirs. Raises for one
-- they may delete but that is not waiting, or that has history.
create or replace function sessclone_delete_pending_org(target uuid)
  returns boolean language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  if not (
    sessclone_is_platform_admin()
    or exists (
      select 1 from members member
        join users person on person.id = member.user_id
       where member.org_id = target
         and member.user_id = sessclone_user_id()
         and member.removed_at is null
         and member.role = 'owner'
         and person.deletion_requested_at is null
    )
  ) then
    return false;
  end if;

  -- Holds the Org against an approval landing between the check and the delete.
  perform 1 from orgs where id = target for update;
  if not found then
    return false;
  end if;

  if exists (
    select 1 from subscriptions
     where org_id = target and status <> 'inactive'
  ) then
    raise exception 'org is not waiting for approval';
  end if;

  begin
    delete from orgs where id = target;
  exception when foreign_key_violation then
    raise exception 'org has history';
  end;
  return true;
end $$;

revoke execute on function sessclone_delete_pending_org(uuid) from public;
grant execute on function sessclone_delete_pending_org(uuid) to sessclone_app;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function sessclone_delete_pending_org(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function sessclone_delete_pending_org(uuid) from authenticated;
  end if;
end $$;
