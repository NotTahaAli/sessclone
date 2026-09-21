-- Ticket 27: the one policy first sign-in needs, which ticket 21 left out.
--
-- `users` shipped with a read policy and an update policy and no insert
-- policy at all, so nothing could create the row for somebody signing in for
-- the first time. On a Supabase project a trigger on `auth.users` is the usual
-- answer; on the plain Postgres a self-hoster runs there is no `auth` schema
-- to hang one on, and ADR 0007 already committed to the application reading
-- and writing as the signed-in person rather than through PostgREST. So the
-- row is created by the application, through a policy, like everything else.
--
-- The insert is as narrow as it can be. `id` must equal the verified claim on
-- the connection, so a signed-in person can create exactly one row and it is
-- their own — they cannot mint a row for somebody else's id and then, through
-- `users_write_self`, own it. And `is_platform_admin` must be false: the
-- update trigger has always refused to grant the flag, and without this line
-- the way around it would be to arrive already holding it.
create policy users_create_self on users for insert
  with check (
    id = (select sessclone_user_id())
    and not is_platform_admin
  );

grant insert on users to sessclone_app; -- users_create_self
