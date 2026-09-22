-- Ticket 61: how long an Org keeps the transcripts it has stored.
--
-- Turns are never touched by Retention: they are the spend history, they are
-- append-only, and a team that loses its cost record because a transcript
-- aged out has lost the thing the product is for. This window covers
-- `log_artifacts` and the objects they name, and nothing else.
--
-- A default rather than a null: "keep forever" is not a decision anybody
-- made, and a deployment that stored transcripts indefinitely by omission is
-- the failure ADR 0005 is about. Ninety days is the window the Tier seed's
-- own copy shows, and any Org may shorten it.

alter table orgs
  add column retention_days integer not null default 90
    check (retention_days > 0 and retention_days <= 3650);

comment on column orgs.retention_days is
  'How many days this Org keeps a stored transcript (ticket 61). Capped by '
  'the Tier''s retention_max_days, enforced by the trigger below. Applies to '
  'log_artifacts only, never to turns.';

-- The Tier's ceiling, enforced where it cannot be bypassed.
--
-- A trigger rather than a `check`, because the ceiling lives in another table
-- and a `check` may not read one. `security definer` for the same reason the
-- helpers in `20260920120000_accounts.sql` are, and with `pg_temp` pinned in
-- `search_path`: Postgres searches `pg_temp` first for a table unless it is
-- named, every role may create temporary tables, and a temporary `tiers` or
-- `subscriptions` would otherwise let a caller declare their own ceiling.
--
-- A raise rather than a silent clamp. An Owner who asks for a year and gets
-- ninety days without being told has been lied to by a form, and the Tier
-- page beside it already states the ceiling.
create or replace function sessclone_guard_org_retention() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  ceiling integer;
begin
  select tier.retention_max_days into ceiling
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

create trigger orgs_guard_retention
  before insert or update of retention_days on orgs
  for each row execute function sessclone_guard_org_retention();

-- What the sweep reads: the artifacts of one Org older than its window, which
-- is `(org_id, uploaded_at)` — already indexed by
-- `log_artifacts_org_uploaded_at_idx`, so this migration adds no index and
-- says so rather than adding a second one that shadows it.
