-- Review fixes for tickets 48 and 65, and two the same review found in the
-- migrations that shipped beside them.

-- 1. The platform-admin exemption on `users.email` was inverted.
--
-- It was added so an operator could correct an address the identity provider
-- changed. It could not: the only update policy on `users` is
-- `users_write_self`, so RLS filters somebody else's row out before the
-- trigger ever sees it. What it did unlock is the one case it said it still
-- prevented — the operator renaming *themselves*. `sessclone_accept_invitation`
-- matches `lower(users.email)` against the invitation, so a Platform Admin
-- could point their own address at any live invitation and walk into that Org,
-- leaving a members row that looks like any ordinary acceptance.
--
-- Platform Admin is deliberately not an Org superuser here: no
-- platform-admin branch exists on `log_artifacts_read` or on the
-- Member-scoped surfaces, so an operator cannot reach a transcript. This
-- closes the self-serve route back in, and opens the one the exemption was
-- written for: somebody else's row, never the caller's own.
create or replace function sessclone_guard_user_email() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.email is distinct from old.email
     and not (sessclone_is_platform_admin()
              and old.id is distinct from sessclone_user_id()) then
    raise exception 'an account''s address comes from the identity provider';
  end if;
  return new;
end $$;

create policy users_write_admin on users for update
  using (
    (select sessclone_is_platform_admin())
    and id is distinct from (select sessclone_user_id())
  )
  with check (
    (select sessclone_is_platform_admin())
    and id is distinct from (select sessclone_user_id())
  );

-- 2. The seat ceiling, deleted from the acceptance rather than duplicated
--    beside it.
--
-- The trigger added in `20260922030000_seat_ceiling.sql` covers the insert
-- this function makes, raising the same message. Leaving the block here left
-- two copies of one rule — the shape that migration exists to eliminate — and
-- inverted the lock order between the two paths: the acceptance takes the
-- advisory lock before touching any member row, the trigger after Postgres has
-- locked the tuple, so a re-admission racing an acceptance of the same person
-- could deadlock. One copy, one lock, taken in one place.
create or replace function sessclone_accept_invitation(presented_hash text)
  returns uuid language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  invite invitations;
  caller uuid := sessclone_user_id();
  caller_email text;
  member_id uuid;
begin
  if caller is null then
    raise exception 'sign in before accepting an invitation';
  end if;

  select email into caller_email from users where id = caller;
  if caller_email is null then
    raise exception 'sign in before accepting an invitation';
  end if;

  select * into invite from invitations
   where token_hash = presented_hash for update;

  if invite.id is null or invite.revoked_at is not null
     or invite.accepted_at is not null then
    raise exception 'this invitation is not valid';
  end if;

  if invite.expires_at <= now() then
    raise exception 'this invitation has expired; ask for another';
  end if;

  if lower(caller_email) <> lower(invite.email) then
    raise exception 'this invitation was sent to a different address';
  end if;

  select id into member_id from members
   where org_id = invite.org_id and user_id = caller and removed_at is null;

  if member_id is null then
    insert into members (org_id, user_id, role)
    values (invite.org_id, caller, invite.role)
    on conflict (org_id, user_id) do update
       set removed_at = null,
           role = excluded.role,
           archival_enabled = false
    returning id into member_id;
  end if;

  update invitations
     set accepted_at = now(), accepted_member_id = member_id
   where id = invite.id;

  return invite.org_id;
end $$;

-- 3. The ceiling helper is `security definer` over `subscriptions` and
--    `tiers`, so its default EXECUTE to PUBLIC let any signed-in user read any
--    Org's seat limit by uuid. Its three siblings each grant explicitly; this
--    one did not.
revoke execute on function sessclone_org_seat_ceiling(uuid) from public;
grant execute on function sessclone_org_seat_ceiling(uuid) to sessclone_app;
