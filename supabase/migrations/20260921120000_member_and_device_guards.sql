-- Ticket 44 found two holes by asserting, as the unprivileged role, what the
-- migrations above claim in prose. Both are closed here rather than by editing
-- those files: they have already been applied to a running project, and a
-- migration that changes after it has run is a migration nobody can trust.

-- **A removed Member could re-admit themselves.**
--
-- The accounts migration leaves a self branch off `members_read` and says why:
-- "that would show a removed Member their own row, and `members_write` would
-- then let them clear their own `removed_at`." That reasoning only covers
-- statements that read a column. `update members set removed_at = null` with
-- no `where` and no `returning` reads nothing, so the select policy never
-- applies, and `members_write`'s `user_id = sessclone_user_id()` branch let it
-- through. A removed person restored their own membership, and with it the
-- Org's Turns, its artifacts, and a Seat.
--
-- Two changes, because either alone leaves a way round. The policy stops a
-- removed Member writing their row at all, and the trigger makes `removed_at`
-- an Owner's or an Admin's column whoever is writing — which is what removal
-- means.
drop policy members_write on members;

create policy members_write on members for update
  using (
    org_id in (select sessclone_admin_org_ids())
    or (user_id = (select sessclone_user_id()) and removed_at is null)
  )
  with check (
    org_id in (select sessclone_admin_org_ids())
    or (user_id = (select sessclone_user_id()) and removed_at is null)
  );

create or replace function sessclone_guard_member_columns() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.archival_enabled and new.user_id is distinct from sessclone_user_id() then
      raise exception 'archival is the member''s own switch';
    end if;
    return new;
  end if;

  if new.org_id is distinct from old.org_id
     or new.user_id is distinct from old.user_id then
    raise exception 'a member row cannot change org or user';
  end if;

  if new.archival_enabled is distinct from old.archival_enabled
     and old.user_id is distinct from sessclone_user_id() then
    raise exception 'archival is the member''s own switch';
  end if;

  if new.role is distinct from old.role
     and old.org_id not in (select sessclone_admin_org_ids()) then
    raise exception 'only an owner or admin may change a role';
  end if;

  -- New. Removal and re-admission are the same act from opposite ends, and
  -- both belong to whoever governs the Org.
  if new.removed_at is distinct from old.removed_at
     and old.org_id not in (select sessclone_admin_org_ids()) then
    raise exception 'only an owner or admin may remove or re-admit a member';
  end if;

  return new;
end
$$;

-- **`devices.last_seen_at` was the Member's to write.**
--
-- The collection migration says the two timestamps "are the row's only
-- provenance: a Member renaming their laptop must not be able to re-point or
-- backdate it", and then pinned `first_seen_at` and forgot its pair. A Member
-- could move the Device's last-seen time in either direction, which is the
-- column the Collector's liveness surface reads.
--
-- `last_seen_at` is the one column here that a legitimate writer moves:
-- ingest touches it on every report, writing as the service role with no
-- claim set (ADR 0001), while every write from the dashboard carries one. So
-- the claim test belongs on that column's branch alone. Putting it at the top
-- of the function instead would unpin `member_id`, `key` and `first_seen_at`
-- for every claimless caller — widening the hole this migration is here to
-- close, in exchange for two fewer lines.
create or replace function sessclone_guard_device_columns() returns trigger
  language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.member_id is distinct from old.member_id
     or new.key is distinct from old.key
     or new.first_seen_at is distinct from old.first_seen_at then
    raise exception 'only the nickname is the member''s to change';
  end if;

  if new.last_seen_at is distinct from old.last_seen_at
     and sessclone_user_id() is not null then
    raise exception 'only the nickname is the member''s to change';
  end if;

  return new;
end
$$;
