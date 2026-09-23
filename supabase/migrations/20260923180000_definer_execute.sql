-- Security definer helpers run as the table owner, and Postgres grants EXECUTE
-- on every new function to PUBLIC (Supabase adds `anon` and `authenticated`).
-- The Data API is off, so nobody could reach them that way, but a closed door
-- beats an unreachable one: only the dashboard's role and the owner call these.
-- Supabase advisor lints 0028 and 0029.

do $$
declare
  routine regprocedure;
begin
  for routine in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', routine);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', routine);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', routine);
    end if;
    if (select prorettype from pg_proc where oid = routine) <> 'trigger'::regtype then
      execute format('grant execute on function %s to sessclone_app', routine);
    end if;
  end loop;
end
$$;

-- PUBLIC's EXECUTE on new functions is a global default that a per-schema
-- default cannot take back, so a later definer function arrives open again;
-- `schema.test.ts` fails CI when one does. Supabase's own per-schema default
-- grants `anon` and `authenticated` on functions `postgres` creates, and that
-- one can be revoked here.
do $$
begin
  if current_user = 'postgres'
     and exists (select 1 from pg_roles where rolname = 'anon')
     and exists (select 1 from pg_roles where rolname = 'authenticated') then
    alter default privileges for role postgres in schema public
      revoke execute on functions from anon, authenticated;
  end if;
end
$$;
