-- Tickets 139 and 141 (Taha, 2026-09-25).
--
-- 139: two limits per Tier, where there was one. `retention_max_days` was
-- always the transcript cap (ticket 61), but the pricing card rendered it as
-- "N days of history", which reads as Turn history — and Turns were never
-- limited. So a Tier now carries a history window as well, and the transcript
-- cap gains a per-Org ceiling for Enterprise contracts.
--
-- 141: deleting your own account. A person is anonymized rather than removed:
-- Turns are the Org's spend record and reference the Member `on delete
-- restrict` (ADR 0006), so the `users` row stays, scrubbed, and every surface
-- that prints `coalesce(display_name, email)` prints "Deleted person · <tag>"
-- without a line of TypeScript knowing about deletion.

-- 1. The Turn history window. Display only: nothing is deleted, and an Org
-- that upgrades sees its older Turns again. Null means unlimited.
alter table tiers
  add column if not exists history_days integer
    check (history_days is null or history_days > 0);

comment on column tiers.history_days is
  'How many days of Turns the dashboard shows an Org on this Tier (ticket '
  '139). Display only; Turns are never deleted. Null is unlimited.';

-- The seeded values are `20260925190100_tier_limits.sql`, so a test can
-- re-apply them the way it re-applies the Tier seed.

-- 2. Enterprise's cap is per contract: a ceiling on the Org's own
-- subscription row, beside the agreed price, written by a Platform Admin
-- (`subscriptions_write` already limits every write to one). Null falls back
-- to the Tier's.
alter table subscriptions
  add column if not exists retention_max_days integer
    check (retention_max_days is null or retention_max_days > 0);

comment on column subscriptions.retention_max_days is
  'This Org''s transcript retention ceiling, agreed by contract (ticket 139). '
  'Overrides tiers.retention_max_days when set.';

-- An Owner asking for a plan at sign-up inserts their own subscription row
-- (`subscriptions_request`); the ceiling is billing like the agreed price, so
-- it is held null there the same way. Recreated as
-- `20260923202000_subscription_price_guards.sql` left it, plus that one line.
drop policy subscriptions_request on subscriptions;

create policy subscriptions_request on subscriptions for insert
  with check (
    status = 'inactive'
    and provider = 'manual'
    and provider_customer_id is null
    and provider_subscription_id is null
    and provider_metadata is null
    and current_period_end is null
    and price_base_cents is null
    and price_seat_cents is null
    and retention_max_days is null
    and exists (
      select 1 from members member
       where member.org_id = subscriptions.org_id
         and member.user_id = (select sessclone_user_id())
         and member.role = 'owner'
         and member.removed_at is null
    )
    and exists (
      select 1 from tiers tier
       where tier.id = subscriptions.tier_id
         and tier.available
         and tier.features @> '{"self_serve": true}'::jsonb
         and requested_seats is not null
         and (tier.min_seats is null or requested_seats >= tier.min_seats)
         and (tier.max_seats is null or requested_seats <= tier.max_seats)
    )
  );

create or replace function sessclone_guard_org_retention() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  ceiling integer;
begin
  select coalesce(subscription.retention_max_days, tier.retention_max_days)
    into ceiling
    from subscriptions subscription
    join tiers tier on tier.id = subscription.tier_id
   where subscription.org_id = new.id
     and subscription.status = 'active';

  if ceiling is not null and new.retention_days > ceiling then
    raise exception 'retention of % days is past this Tier''s ceiling of % days',
      new.retention_days, ceiling
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

-- A lower ceiling, from a Tier change or a contract edit, brings an Org's own
-- setting down with it, so Org settings never shows a window the sweep does
-- not honour. Runs as the owner: the Platform Admin who saved it may not
-- write the Org's row.
create or replace function sessclone_clamp_org_retention() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.status = 'active' then
    update orgs org
       set retention_days = ceiling.days
      from (select coalesce(new.retention_max_days, tier.retention_max_days) as days
              from tiers tier where tier.id = new.tier_id) ceiling
     where org.id = new.org_id
       and ceiling.days is not null
       and org.retention_days > ceiling.days;
  end if;
  return null;
end $$;

revoke execute on function sessclone_clamp_org_retention() from public;

create trigger subscriptions_clamp_retention
  after insert or update of tier_id, status, retention_max_days on subscriptions
  for each row execute function sessclone_clamp_org_retention();

-- 3. The history window, where every dashboard read already goes: the read
-- policies on `turns` and `session_events` (and `turn_costs`, which is
-- `security_invoker` over `turns`). A Session straddling the edge then counts
-- only its Turns inside the window everywhere — list, detail, Costs — so no
-- two surfaces disagree, and no surface added later can forget the window.
--
-- The floor is the start of the Org's day, in its timezone, `history_days`
-- ago, so a day's bar on the Costs chart is never half a day.
--
-- One jsonb of member id to floor, built once per statement: `(select …)` in
-- a policy is an InitPlan, so each row pays a lookup rather than a query. A
-- member whose Tier has no window, or whose Org has no live subscription, is
-- absent and sees everything, as before.
create or replace function sessclone_visible_member_floors() returns jsonb
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select coalesce(jsonb_object_agg(
           member.id,
           (date_trunc('day', now() at time zone org.timezone)
             - make_interval(days => tier.history_days)) at time zone org.timezone
         ), '{}'::jsonb)
    from members member
    join orgs org on org.id = member.org_id
    join subscriptions subscription
      on subscription.org_id = member.org_id
     and subscription.status in ('active', 'past_due')
    join tiers tier on tier.id = subscription.tier_id
   where tier.history_days is not null
     and member.id in (select sessclone_visible_member_ids())
$$;

drop policy turns_read on turns;
create policy turns_read on turns for select
  using (
    member_id in (select sessclone_visible_member_ids())
    and occurred_at >= coalesce(
      ((select sessclone_visible_member_floors()) ->> member_id::text)::timestamptz,
      '-infinity')
  );

drop policy session_events_read on session_events;
create policy session_events_read on session_events for select
  using (
    member_id in (select sessclone_visible_member_ids())
    and occurred_at >= coalesce(
      ((select sessclone_visible_member_floors()) ->> member_id::text)::timestamptz,
      '-infinity')
  );

-- Whether a Session has Turns before the window, for the detail page's note.
-- Definer, because the policy above is exactly what hides them; it answers
-- only for a member the caller can already see.
create or replace function sessclone_session_has_hidden_turns(
  member uuid, session text
) returns boolean
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select exists (
    select 1 from turns turn
     where turn.member_id = member
       and turn.session_id = session
       and member in (select sessclone_visible_member_ids())
       and turn.occurred_at < coalesce(
         ((select sessclone_visible_member_floors()) ->> member::text)::timestamptz,
         '-infinity')
  )
$$;

-- 4. Deleting an account. `deletion_requested_at` starts the 14-day grace;
-- `deleted_at` says the scrub below ran. The sign-in (`auth.users`) is removed
-- after that through Supabase's Admin API, and `deletion_requested_at` is
-- cleared once it is — so "scrubbed, sign-in not yet removed" is both set.
alter table users
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deleted_at timestamptz;

comment on column users.deletion_requested_at is
  'When this person asked for their account to be deleted (ticket 141). '
  'Frozen for 14 days, then scrubbed. Cleared once the sign-in is removed.';
comment on column users.deleted_at is
  'When this person was scrubbed: name and email replaced, memberships '
  'removed, keys revoked, transcripts deleted. Turns remain.';

create index if not exists users_deletion_due_idx on users (deletion_requested_at)
  where deletion_requested_at is not null;

-- Whether the write in progress is one of the functions below. The setting
-- alone is not enough, since any role may set a custom setting; the functions
-- are `security definer`, so they also run as the table's owner, which the
-- dashboard role never is.
create or replace function sessclone_in_account_deletion() returns boolean
  language sql stable set search_path = pg_catalog, public, pg_temp as $$
  select coalesce(current_setting('sessclone.account_deletion', true), '') = 'on'
     and pg_has_role(current_user,
                     (select relowner from pg_class where oid = 'public.users'::regclass),
                     'MEMBER')
$$;

-- Nobody writes these two columns but the functions below. `users_write_self`
-- lets a person update their own row, which would otherwise let them skip the
-- last-Owner check, or mark themselves deleted without being scrubbed.
create or replace function sessclone_guard_user_deletion() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if (new.deletion_requested_at is distinct from old.deletion_requested_at
      or new.deleted_at is distinct from old.deleted_at)
     and not sessclone_in_account_deletion() then
    raise exception 'account deletion goes through its own functions';
  end if;
  return new;
end $$;

-- The address comes from the identity provider (`20260922040000_admin_review.sql`)
-- — except when the scrub replaces it, which is the point of the scrub.
create or replace function sessclone_guard_user_email() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.email is distinct from old.email
     and not (sessclone_is_platform_admin()
              and old.id is distinct from sessclone_user_id())
     and not (sessclone_in_account_deletion() and new.deleted_at is not null) then
    raise exception 'an account''s address comes from the identity provider';
  end if;
  return new;
end $$;

create trigger users_guard_deletion
  before update on users
  for each row execute function sessclone_guard_user_deletion();

-- The last Owner of an Org with anyone else in it must hand over first. An
-- Org where they are the only Member closes with the account. Returns the
-- Orgs that block, so the page can name them.
create or replace function sessclone_deletion_blockers(person uuid)
  returns table (org_id uuid, org_name text)
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select org.id, org.name
    from members mine
    join orgs org on org.id = mine.org_id
   where mine.user_id = person
     and mine.removed_at is null
     and mine.role = 'owner'
     and not exists (
       select 1 from members owner
         join users account on account.id = owner.user_id
        where owner.org_id = mine.org_id
          and owner.id <> mine.id
          and owner.role = 'owner'
          and owner.removed_at is null
          and account.deletion_requested_at is null
     )
     and exists (
       select 1 from members other
        where other.org_id = mine.org_id
          and other.removed_at is null
          and other.id <> mine.id
     )
   order by org.name
$$;

create or replace function sessclone_own_deletion_blockers()
  returns table (org_id uuid, org_name text)
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select * from sessclone_deletion_blockers(sessclone_user_id())
$$;

-- Starts the grace. The caller's own row only. The app checks that the
-- sign-in is fresh and that the typed email matches before calling.
create or replace function sessclone_request_account_deletion()
  returns timestamptz language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  person uuid := sessclone_user_id();
  requested timestamptz;
begin
  if person is null then
    raise exception 'not signed in';
  end if;

  -- Locked first, as `sessclone_leave_org` does, so a role change racing the
  -- request cannot slip a sole Owner past the check. The Org lock is the one
  -- the last-Owner trigger takes, so two co-Owners asking at once, or one
  -- asking while the other leaves, run one after the other and the second
  -- sees the first.
  perform pg_advisory_xact_lock(hashtextextended(mine.org_id::text, 0))
     from (select distinct org_id from members
            where user_id = person and removed_at is null and role = 'owner'
            order by org_id) mine;
  perform 1 from members
   where user_id = person and removed_at is null
   order by id
   for update;

  if exists (select 1 from sessclone_deletion_blockers(person)) then
    raise exception 'hand over ownership first'
      using hint = 'make somebody else an owner of every org you own';
  end if;

  perform set_config('sessclone.account_deletion', 'on', true);
  update users
     set deletion_requested_at = coalesce(deletion_requested_at, now())
   where id = person and deleted_at is null
  returning deletion_requested_at into requested;
  perform set_config('sessclone.account_deletion', '', true);

  if requested is null then
    raise exception 'no such account';
  end if;
  return requested;
end $$;

-- Keep my account: the whole grace undone. Nothing was changed but the flag.
create or replace function sessclone_cancel_account_deletion()
  returns void language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform set_config('sessclone.account_deletion', 'on', true);
  update users set deletion_requested_at = null
   where id = sessclone_user_id() and deleted_at is null;
  perform set_config('sessclone.account_deletion', '', true);
end $$;

-- The scrub, run by the deployment's cron as the owning role after the grace.
-- Never granted to `sessclone_app`: nothing the browser reaches may call it.
--
-- One person, one transaction:
--   a. an Org where they are the only live Member closes: its subscription is
--      cancelled, which locks it, and nobody is left to see it;
--   b. every membership is removed and every API key revoked;
--   c. their transcripts' rows go and the keys join `storage_orphans`, which
--      the retention sweep deletes from storage;
--   d. name and email are replaced. The tag is stable and short, so two
--      deleted people in one Org stay two rows, and is not the id.
-- An Owner in their grace does not count as one (`sessclone_org_owners`
-- below), so nobody can leave them the last Owner of a shared Org, and
-- nobody can join an Org whose only Owner is leaving. A person who is a
-- blocker anyway is skipped, and the cron leaves them out.
create or replace function sessclone_finalize_account_deletion(person uuid)
  returns boolean language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  tag text := left(md5(person::text), 4);
begin
  perform 1 from users
   where id = person
     and deleted_at is null
     and deletion_requested_at <= now() - interval '14 days'
   for update;
  if not found then
    return false;
  end if;

  if exists (select 1 from sessclone_deletion_blockers(person)) then
    return false;
  end if;

  -- The rest runs as the person, transaction-local: the member and device
  -- guards then read each write as their own leaving, which they allow, and
  -- no guard needs an exception for this function.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', person)::text, true);

  update subscriptions subscription
     set status = 'cancelled'
   where subscription.status <> 'cancelled'
     and subscription.org_id in (
       select mine.org_id from members mine
        where mine.user_id = person and mine.removed_at is null
          and not exists (
            select 1 from members other
             where other.org_id = mine.org_id
               and other.removed_at is null
               and other.user_id <> person
          )
     );

  -- A closed Org takes no one in later on an invitation sent before.
  update invitations invitation
     set revoked_at = now()
   where invitation.revoked_at is null
     and invitation.accepted_at is null
     and invitation.declined_at is null
     and invitation.org_id in (
       select mine.org_id from members mine
        where mine.user_id = person and mine.removed_at is null
          and not exists (
            select 1 from members other
             where other.org_id = mine.org_id
               and other.removed_at is null
               and other.user_id <> person
          )
     );

  -- Invitations are addressed to the email the scrub below replaces, and an
  -- Admin's list shows them; they go, as a sent invitation is fixed.
  delete from invitations invitation
   using users account
   where account.id = person
     and lower(btrim(invitation.email)) = lower(btrim(account.email));

  delete from transcript_view_presets where user_id = person;

  update api_keys set revoked_at = now()
   where revoked_at is null
     and member_id in (select id from members where user_id = person);

  update devices set nickname = null
   where member_id in (select id from members where user_id = person);

  with doomed as (
    select id, storage_key from log_artifacts
     where member_id in (select id from members where user_id = person)
  ), chunks as (
    delete from log_artifact_chunks
     where artifact_id in (select id from doomed)
    returning storage_key
  ), artifacts as (
    delete from log_artifacts
     where id in (select id from doomed)
    returning storage_key
  )
  insert into storage_orphans (storage_key)
  select storage_key from artifacts
  union
  select storage_key from chunks
  on conflict (storage_key) do nothing;

  update members set removed_at = now()
   where user_id = person and removed_at is null;

  perform set_config('sessclone.account_deletion', 'on', true);
  update users
     set display_name = 'Deleted person · ' || tag,
         email = 'deleted-' || md5(person::text) || '@deleted.invalid',
         deleted_at = now()
   where id = person;
  perform set_config('sessclone.account_deletion', '', true);

  return true;
end $$;

-- Once the Admin API has removed the sign-in.
create or replace function sessclone_forget_deletion_request(person uuid)
  returns void language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform set_config('sessclone.account_deletion', 'on', true);
  update users set deletion_requested_at = null
   where id = person and deleted_at is not null;
  perform set_config('sessclone.account_deletion', '', true);
end $$;

-- The last Owner may be removed only by an account deletion, and only when
-- nobody else is left: the scrub above removes a sole Member's membership,
-- and the Org it leaves is closed. Leaving by hand stays refused. The body is
-- `20260925120000_org_switcher.sql`'s, lock included, with that one exception
-- added. The trigger is deferred to commit, after the flag above is off, so
-- the exception reads the scrub's own mark: only the definer functions can
-- set `deleted_at`, and the `exists` is reached only then, as the owning
-- role, which the policies cannot hide the Org's other Members from.
create or replace function sessclone_guard_last_owner() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if old.role = 'owner' and old.removed_at is null
     and (new.role <> 'owner' or new.removed_at is not null) then
    perform pg_advisory_xact_lock(hashtextextended(old.org_id::text, 0));
    if sessclone_org_owners(old.org_id) = 0
       and (not exists (select 1 from users
                         where id = old.user_id and deleted_at is not null)
            or exists (select 1 from members
                        where org_id = old.org_id and removed_at is null)) then
      raise exception 'an org keeps at least one owner'
        using hint = 'make somebody else an owner first';
    end if;
  end if;
  return null;
end $$;

-- An Owner in their deletion grace no longer counts as one. Every rule that
-- asks "is there an Owner left" reads this, so a co-Owner cannot leave or
-- step down behind someone who is leaving, and the last-Owner trigger holds
-- the Org to an Owner who is staying. `20260922010000_last_owner.sql`'s body
-- with that one condition added.
create or replace function sessclone_org_owners(org uuid) returns integer
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select count(*)::integer from members member
    join users account on account.id = member.user_id
   where member.org_id = org and member.role = 'owner'
     and member.removed_at is null
     and account.deletion_requested_at is null
$$;

-- `20260925120000_org_switcher.sql`'s accept, with the two refusals above
-- the insert added.
create or replace function sessclone_accept_own_invitation(
  invitation_id uuid, verified_email text
) returns uuid language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  invite invitations;
  caller uuid := sessclone_user_id();
  joined uuid;
begin
  if caller is null or coalesce(btrim(verified_email), '') = '' then
    raise exception 'sign in before accepting an invitation';
  end if;

  -- `for update` so two tabs accepting the same invitation at once cannot
  -- both pass the used-and-expired checks below.
  select * into invite from invitations where id = invitation_id for update;

  -- One message for absent, revoked, declined and already-used alike: telling
  -- them apart tells a stranger which invitations once existed.
  if invite.id is null or invite.revoked_at is not null
     or invite.accepted_at is not null or invite.declined_at is not null then
    raise exception 'this invitation is not valid';
  end if;

  if invite.expires_at <= now() then
    raise exception 'this invitation has expired; ask for another';
  end if;

  if lower(btrim(verified_email)) <> lower(btrim(invite.email)) then
    raise exception 'this invitation was sent to a different address';
  end if;

  -- Ticket 141: nobody joins in their own deletion grace, or after it, and
  -- nobody joins an Org whose only Owner is leaving or gone: they would be
  -- left in it with nobody to run it.
  if exists (select 1 from users
              where id = caller
                and (deletion_requested_at is not null or deleted_at is not null)) then
    raise exception 'this account is being deleted';
  end if;
  if sessclone_org_owners(invite.org_id) = 0 then
    raise exception 'this invitation is not valid';
  end if;

  -- Already in the Org: the invitation is spent and the Role left alone.
  select id into joined from members
   where org_id = invite.org_id and user_id = caller and removed_at is null;

  if joined is null then
    -- The re-admission branch of the guard above reads this.
    perform set_config('sessclone.admitting', invite.id::text, true);

    insert into members (org_id, user_id, role)
    values (invite.org_id, caller, invite.role)
    on conflict (org_id, user_id) do update
       set removed_at = null,
           role = excluded.role,
           archival_enabled = false
    returning id into joined;

    perform set_config('sessclone.admitting', '', true);
  end if;

  update invitations
     set accepted_at = now(), accepted_member_id = joined
   where id = invite.id;

  return joined;
end $$;

-- When the sweep takes an Org's transcripts because its Tier keeps none
-- (ticket 139): seven days after it moved off the last Tier that kept them,
-- which is the first subscription event after that Tier's last one. Price or
-- note edits after the move do not restart it. An Org that never had such a
-- Tier has no transcripts to keep and gets `-infinity`. Null while the Org's
-- active Tier keeps transcripts. One reading, for the sweep and the banner.
create or replace function sessclone_transcripts_end(org uuid)
  returns timestamptz language sql stable
  set search_path = pg_catalog, public, pg_temp as $$
  select coalesce(
           (select min(event.occurred_at) from subscription_events event
             where event.org_id = org
               and event.occurred_at > coalesce(
                 (select max(kept.occurred_at) from subscription_events kept
                    join tiers kept_tier on kept_tier.id = kept.tier_id
                   where kept.org_id = org and kept_tier.archival_available),
                 '-infinity')),
           '-infinity') + interval '7 days'
    from subscriptions subscription
    join tiers tier on tier.id = subscription.tier_id
   where subscription.org_id = org
     and subscription.status = 'active'
     and not tier.archival_available
$$;

revoke execute on function sessclone_transcripts_end(uuid) from public;
grant execute on function sessclone_transcripts_end(uuid) to sessclone_app;

revoke execute on function sessclone_visible_member_floors() from public;
revoke execute on function sessclone_session_has_hidden_turns(uuid, text) from public;
grant execute on function sessclone_visible_member_floors() to sessclone_app;
grant execute on function sessclone_session_has_hidden_turns(uuid, text) to sessclone_app;
revoke execute on function sessclone_deletion_blockers(uuid) from public;
revoke execute on function sessclone_own_deletion_blockers() from public;
revoke execute on function sessclone_request_account_deletion() from public;
revoke execute on function sessclone_cancel_account_deletion() from public;
revoke execute on function sessclone_finalize_account_deletion(uuid) from public;
revoke execute on function sessclone_forget_deletion_request(uuid) from public;
grant execute on function sessclone_own_deletion_blockers() to sessclone_app;
grant execute on function sessclone_request_account_deletion() to sessclone_app;
grant execute on function sessclone_cancel_account_deletion() to sessclone_app;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function sessclone_visible_member_floors() from anon, authenticated;
    revoke execute on function sessclone_transcripts_end(uuid) from anon, authenticated;
    revoke execute on function sessclone_session_has_hidden_turns(uuid, text) from anon, authenticated;
    revoke execute on function sessclone_deletion_blockers(uuid) from anon, authenticated;
    revoke execute on function sessclone_own_deletion_blockers() from anon, authenticated;
    revoke execute on function sessclone_request_account_deletion() from anon, authenticated;
    revoke execute on function sessclone_cancel_account_deletion() from anon, authenticated;
    revoke execute on function sessclone_finalize_account_deletion(uuid) from anon, authenticated;
    revoke execute on function sessclone_forget_deletion_request(uuid) from anon, authenticated;
  end if;
end
$$;
