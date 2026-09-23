-- Ticket 120: tell the platform admins that somebody signed up.
--
-- The callback that creates an Org runs as the person signing up, and
-- `users_read` shows them nobody outside their own Org — rightly. So the
-- operators' addresses come from this one `security definer` helper, and it
-- answers only the question the callback asks: the Owner of an Org that is
-- waiting for approval (no subscription row, or `inactive`) may learn where
-- to send the notice about it. Anybody else, or an Org already approved,
-- gets nothing. Bounded, because it feeds one email's To line.
--
-- Additive: a new function that the code already deployed never calls.
create or replace function sessclone_signup_notice_recipients(org uuid)
  returns setof text
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select admin.email
    from users admin
   where admin.is_platform_admin
     and exists (
       select 1 from members member
        where member.org_id = org
          and member.user_id = sessclone_user_id()
          and member.role = 'owner'
          and member.removed_at is null
     )
     and not exists (
       select 1 from subscriptions subscription
        where subscription.org_id = org
          and subscription.status <> 'inactive'
     )
   order by admin.email
   limit 20
$$;

revoke all on function sessclone_signup_notice_recipients(uuid) from public;
grant execute on function sessclone_signup_notice_recipients(uuid) to sessclone_app;
