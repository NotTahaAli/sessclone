-- Ticket 20: the role the dashboard connects as.
--
-- `enable row level security` is not enforcement on its own. Postgres applies
-- no policy to a superuser, and none to the role that owns the table — and the
-- role that applies these migrations owns every table they create. ADR 0007
-- names that as the read path's one structural risk and leaves it at "the
-- application must connect as a role that is neither". Until this migration
-- there was no such role to connect as, so the policies above were rules with
-- nobody subject to them: a policy test written against the applying role
-- passes while enforcing nothing, and the dashboard reading the same way would
-- read every Org's data.
--
-- The alternative was `force row level security`, which subjects the owner to
-- its own policies. It was tried and rejected, for two reasons that were
-- measured rather than argued.
--
-- It breaks ingest. `turns` carries no insert policy at all, deliberately —
-- ingest writes with a role that bypasses policies, which on Supabase is
-- `service_role` and on a plain Postgres is the owner these migrations run as.
-- Under `force`, that insert becomes `new row violates row-level security
-- policy for table "turns"`, and a self-hosted deployment has no role left
-- that can write a Turn.
--
-- It also breaks the helpers. Every policy above resolves through
-- `security definer` functions that read `members`, and `security definer` is
-- only a cycle-breaker because the definer owns the table and is therefore
-- exempt. Take the exemption away and the policy on `members` calls
-- `sessclone_org_ids()`, which reads `members`, which runs the policy again:
-- `stack depth limit exceeded`. `set row_security = off` inside the function
-- does not rescue it — Postgres answers "query would be affected by
-- row-level security policy".
--
-- Both are repairable only by a `bypassrls` role to own the functions, and
-- `bypassrls` can be granted only by a superuser: as the migration role,
-- `create role … bypassrls` is refused outright. A self-hoster should not need
-- superuser to apply a migration and a Supabase project does not offer one. So
-- the owner keeps its bypass and stays ingest's path, and the dashboard stops
-- being the owner.
--
-- As everywhere else in these migrations, no Supabase-only role is named:
-- `sessclone_app` is an ordinary Postgres role and exists on a plain cluster
-- exactly as it does on a project.

-- Roles are cluster-wide rather than per-database, and a deployment may have
-- created this one already — with a password, or as a group granted to an
-- existing login role. Either way the grants below are what matter, so this
-- creates the role only if it is missing and takes no view on how it
-- authenticates. `nologin` because a migration must not invent a credential:
-- the deployment gives it `login` and a password, or grants it to a role that
-- already has both.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sessclone_app') then
    create role sessclone_app nologin;
  end if;
end $$;

grant usage on schema public to sessclone_app;

-- Read is the dashboard's whole job (ADR 0007): the charts are aggregates over
-- these ten tables, and every row they return is already filtered by the
-- policies above. `probe_rows` is deliberately absent — ticket 02's throwaway
-- table has no row-level security, so granting the dashboard role a read on it
-- would reintroduce in one table exactly what this migration closes.
grant select on
  orgs, users, members, api_keys, member_scopes,
  devices, projects, turns, session_events, member_project_archival
  to sessclone_app;

-- Write verbs only where a policy exists to govern them, which is least
-- privilege and also a second lock: a table with no policy for a verb — `turns`
-- and `session_events` for every write, `projects` for every write — is not
-- merely unmatched, it is unreachable. Append-only stays append-only even if a
-- later policy is written carelessly.
grant insert, update on orgs to sessclone_app;              -- orgs_create, orgs_write
grant update on users to sessclone_app;                     -- users_write_self
grant insert, update on members to sessclone_app;           -- members_invite, members_write
grant insert, update, delete on api_keys to sessclone_app;  -- api_keys_own (for all)
grant insert on member_scopes to sessclone_app;             -- member_scopes_assign
grant delete on member_scopes to sessclone_app;             -- member_scopes_revoke
grant update on devices to sessclone_app;                   -- devices_rename
grant insert, update, delete on member_project_archival     -- member_project_archival_own
  to sessclone_app;
