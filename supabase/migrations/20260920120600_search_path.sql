-- Closing a hole that every policy in this schema rested on.
--
-- Each `security definer` helper was declared `set search_path = public`, which
-- reads as "resolve names in public and nowhere else" and does not mean that.
-- Postgres searches `pg_temp` *before* every schema on the path when resolving
-- a relation, unless `pg_temp` appears on the path explicitly — and `TEMP` on a
-- database is granted to `PUBLIC`, so `sessclone_app` has it.
--
-- So any session on the dashboard's own role could do this:
--
--   create temp table users (id uuid, is_platform_admin boolean);
--   insert into users values ('<their own user id>', true);
--   -- sessclone_is_platform_admin() now returns true
--
-- and from there write the global rate table, create a Tier, and activate
-- their own Org's subscription — the three things the comments in
-- `20260920120300_rates.sql` and `20260920120400_billing_artifacts.sql` say are
-- impossible. A temp `members` table shadows `sessclone_org_ids()` and
-- `sessclone_visible_member_ids()` the same way, which is every other Org's
-- Turns and Log Artifacts. A temp `subscription_events` table makes the
-- activation trigger write its audit row somewhere nobody reads, against
-- exactly the actor the trail exists to record.
--
-- It was latent before this point: nothing valuable hung off
-- `sessclone_is_platform_admin()` until the pricing and billing tables landed.
-- It is not reachable through the application either — `apps/web/lib/db.ts`
-- issues parameterised statements only, and creating a temp table is not
-- something a page can express. It needs a Postgres session on the role, which
-- is a leaked `DATABASE_URL` or a self-hoster at a psql prompt. That is still
-- the one assumption ADR 0007 rests on, and `app-role.test.ts` checks
-- `rolsuper`, `rolbypassrls` and ownership — none of which this touches.
--
-- The fix is to name `pg_temp` on the path, last, where it is searched after
-- `public` rather than before it. Functions and operators are never resolved
-- from `pg_temp`, so relations were the whole exposure.
--
-- Every function below is byte-identical to its original except for the path.
-- They are replaced here rather than edited in place because a deployment may
-- already have applied those migrations, and a migration that is rewritten
-- after it has run is a migration that has not run.

alter function sessclone_is_platform_admin() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_org_ids() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_admin_org_ids() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_own_member_ids() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_visible_member_ids() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_org_has_members(uuid) set search_path = pg_catalog, public, pg_temp;
alter function sessclone_visible_user_ids() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_visible_project_ids() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_write_subscription_event() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_touch_updated_at() set search_path = pg_catalog, public, pg_temp;

-- The trigger guards are not `security definer` — they run as the caller, who
-- is subject to policies anyway — but they resolve relations through the
-- caller's path, and a pinned path costs nothing.
alter function sessclone_guard_platform_admin() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_guard_member_columns() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_guard_key_revocation() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_guard_device_columns() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_user_id() set search_path = pg_catalog, public, pg_temp;
alter function sessclone_rate_unit(rate_class) set search_path = pg_catalog, public, pg_temp;
alter function sessclone_resolve_rate(uuid, text, rate_class, date)
  set search_path = pg_catalog, public, pg_temp;

-- An Org's subscription is its own. Without this the audit trail has a hole
-- that is not an activation and so writes no event: moving the row to another
-- Org leaves that Org entitled — the entitlement check reads status and Tier
-- from this one row — with a billing history that names somebody else, and
-- `subscription_events_read` filters on `org_id`, so its Owner sees nothing at
-- all. Pinned rather than merely added to the trigger's comparison, for the
-- same reason `members.org_id` is pinned: a row's identity is set at insert.
create or replace function sessclone_guard_subscription_org() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'a subscription cannot change org';
  end if;
  return new;
end
$$;

create trigger subscriptions_guard_org
  before update on subscriptions
  for each row execute function sessclone_guard_subscription_org();
