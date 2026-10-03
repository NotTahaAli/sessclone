-- Turn rollups: the dashboard reads pre-summed rows, not every Turn.
--
-- Every Costs and Sessions read priced each Turn in its period and then
-- summed, so a read cost as much as the period had Turns. In production on
-- 2026-10-03 one Org's 30-day Costs read took 0.41s over 21k Turns before
-- row-level security, sorting to disk; locally, 200k Turns made the same read
-- 0.65s as `sessclone_app`. At a million Turns a period it is tens of seconds.
--
-- `turn_rollups` holds one row per group of Turns that every dashboard read
-- treats alike: the same Session, Agent Run, Project, Device and model, on the
-- same Org-local day, priced with the same multiplier and consuming the same
-- set of counters. Its sums are the Turns' sums, so a read sums a few rows
-- where it summed many.
--
-- Prices stay out of it. `turn_rollup_costs` prices each row at read time the
-- way `turn_costs` prices a Turn, so a Rate change still reprices history with
-- no backfill (ticket 42). That is exact, not an approximation: a Turn's cost
-- is each counter times the class's Rate times the multiplier, the Rate is
-- fixed by (Org, model, local day), and the multiplier is in the key, so the
-- sum of the Turns' costs is the group's counters times the same Rates. A
-- group is wholly priced or wholly unpriced for the same reason: `shape`
-- records which counters are non-zero and whether the cache-write split falls
-- short, which is everything `turn_costs.unpriced` reads besides the Rates.
--
-- Kept current by statement triggers on `turns`: an insert adds its Turns'
-- sums; an update or delete recomputes the groups it touched from `turns`,
-- because a first or last instant cannot be subtracted. Changing an Org's
-- timezone moves its Turns between local days, so that rebuilds the Org.

create table turn_rollups (
  org_id uuid not null references orgs (id) on delete cascade,
  member_id uuid not null,
  session_id text not null,
  agent_id text,
  project_id uuid,
  device_id uuid,
  model text,
  -- The Org-local day, and its first instant. The instant is what reads
  -- filter on, with the same expression they filter `turns.occurred_at` with,
  -- and what `turn_rollups_read` compares with the history floor — which is
  -- itself the first instant of an Org-local day, so a row is wholly inside
  -- or wholly outside it.
  day date not null,
  day_start timestamptz not null,
  multiplier numeric not null,
  shape smallint not null,
  turns bigint not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  cache_read_input_tokens bigint not null,
  cache_creation_input_tokens bigint not null,
  cache_creation_5m_input_tokens bigint not null,
  cache_creation_1h_input_tokens bigint not null,
  thinking_tokens bigint not null,
  web_search_requests bigint not null,
  web_fetch_requests bigint not null,
  first_at timestamptz not null,
  last_at timestamptz not null
);

create unique index turn_rollups_key on turn_rollups (
  org_id, day_start, member_id, session_id, agent_id, project_id, device_id,
  model, multiplier, shape
) nulls not distinct;
create index turn_rollups_session_idx on turn_rollups (member_id, session_id);
create index turn_rollups_device_idx on turn_rollups (device_id, day_start);
create index turn_rollups_member_project_idx on turn_rollups (member_id, project_id);

alter table turn_rollups enable row level security;

-- `turns_read`, on the same two columns: the rows of the people the viewer may
-- see, inside their history window.
create policy turn_rollups_read on turn_rollups for select
  using (
    member_id in (select sessclone_visible_member_ids())
    and day_start >= coalesce(
      ((select sessclone_visible_member_floors()) ->> member_id::text)::timestamptz,
      '-infinity')
  );

grant select on turn_rollups to sessclone_app;

-- Which counters a Turn consumed, and whether its cache-write split falls
-- short of the reported total: the inputs to `unpriced` besides the Rates.
create or replace function sessclone_turn_shape(
  input bigint, output bigint, cache_read bigint, cache_creation bigint,
  cache_5m bigint, cache_1h bigint, web_search bigint, web_fetch bigint)
  returns smallint
  language sql immutable parallel safe
  set search_path = pg_catalog, public, pg_temp as $$
  -- Each shift parenthesised: `|` and `<<` share one precedence in Postgres
  -- and associate left, so `a | b << 1` would shift `a | b`.
  select ((input > 0)::int
        | ((output > 0)::int << 1)
        | ((cache_read > 0)::int << 2)
        | ((cache_5m > 0)::int << 3)
        | ((cache_1h > 0)::int << 4)
        | ((web_search > 0)::int << 5)
        | ((web_fetch > 0)::int << 6)
        | ((cache_creation > cache_5m + cache_1h)::int << 7))::smallint
$$;

-- The groups a set of Turns falls in, summed. One definition, used by the
-- insert trigger (over the new rows) and by the recompute (over `turns`).
-- `security definer` because the triggers fire for whoever writes `turns`,
-- and the Org's timezone is read whether or not that writer may see the Org.
create or replace function sessclone_rollup_rows(turn_rows turns[])
  returns setof turn_rollups
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select turn.org_id, turn.member_id, turn.session_id, turn.agent_id,
         turn.project_id, turn.device_id, turn.model,
         local.day,
         local.day::timestamp at time zone org.timezone,
         sessclone_price_multiplier(turn.model, turn.speed, turn.inference_geo,
           turn.service_tier),
         sessclone_turn_shape(turn.input_tokens, turn.output_tokens,
           turn.cache_read_input_tokens, turn.cache_creation_input_tokens,
           turn.cache_creation_5m_input_tokens,
           turn.cache_creation_1h_input_tokens, turn.web_search_requests,
           turn.web_fetch_requests),
         count(*), sum(turn.input_tokens), sum(turn.output_tokens),
         sum(turn.cache_read_input_tokens),
         sum(turn.cache_creation_input_tokens),
         sum(turn.cache_creation_5m_input_tokens),
         sum(turn.cache_creation_1h_input_tokens),
         sum(turn.thinking_tokens), sum(turn.web_search_requests),
         sum(turn.web_fetch_requests),
         min(turn.occurred_at), max(turn.occurred_at)
    from unnest(turn_rows) turn
    join orgs org on org.id = turn.org_id
   cross join lateral (
     select (turn.occurred_at at time zone org.timezone)::date as day
   ) local
   group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
$$;

-- Every write to an Org's rollups holds that Org's advisory lock: shared for
-- adding Turns, exclusive for the two rebuilds below. Adds commute with one
-- another, so ingest never waits on ingest. A rebuild does not commute with an
-- add: it deletes rows and re-reads `turns`, and a Turn whose add landed in
-- between would be counted twice, or summed into a day of the old timezone.
-- One lock per Org, not per Session, so a rebuild touching thousands of
-- Sessions still holds one lock rather than filling the lock table.
--
-- Adds a set of Turns to their groups. Sorted by key so two writers touching
-- the same groups lock them in the same order rather than deadlocking.
-- plpgsql, so the insert takes its snapshot after the lock is granted and sees
-- everything the rebuild it waited on committed, the timezone included.
create or replace function sessclone_rollup_add(turn_rows turns[])
  returns void
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform pg_advisory_xact_lock_shared(
            hashtextextended('sessclone_turn_rollups:' || org.org_id::text, 0))
     from (select distinct turn.org_id from unnest(turn_rows) turn
            order by 1) org;
  insert into turn_rollups
  select * from sessclone_rollup_rows(turn_rows) added
   order by added.org_id, added.day_start, added.member_id, added.session_id,
            added.agent_id, added.project_id, added.device_id, added.model,
            added.multiplier, added.shape
  on conflict (org_id, day_start, member_id, session_id, agent_id, project_id,
               device_id, model, multiplier, shape)
  do update set
    turns = turn_rollups.turns + excluded.turns,
    input_tokens = turn_rollups.input_tokens + excluded.input_tokens,
    output_tokens = turn_rollups.output_tokens + excluded.output_tokens,
    cache_read_input_tokens
      = turn_rollups.cache_read_input_tokens + excluded.cache_read_input_tokens,
    cache_creation_input_tokens = turn_rollups.cache_creation_input_tokens
      + excluded.cache_creation_input_tokens,
    cache_creation_5m_input_tokens = turn_rollups.cache_creation_5m_input_tokens
      + excluded.cache_creation_5m_input_tokens,
    cache_creation_1h_input_tokens = turn_rollups.cache_creation_1h_input_tokens
      + excluded.cache_creation_1h_input_tokens,
    thinking_tokens = turn_rollups.thinking_tokens + excluded.thinking_tokens,
    web_search_requests
      = turn_rollups.web_search_requests + excluded.web_search_requests,
    web_fetch_requests
      = turn_rollups.web_fetch_requests + excluded.web_fetch_requests,
    first_at = least(turn_rollups.first_at, excluded.first_at),
    last_at = greatest(turn_rollups.last_at, excluded.last_at);
end
$$;

-- Rebuilds every group of the given Sessions from `turns`. Coarser than the
-- groups an update touched, and simpler for it: a Session's rows are few, and
-- updates and deletes are rare (a Device or Project deleted, the demo pruned).
create or replace function sessclone_rollup_recompute(
  member_ids uuid[], session_ids text[])
  returns void
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(
            hashtextextended('sessclone_turn_rollups:' || org.org_id::text, 0))
     from (select distinct member.org_id from members member
            where member.id = any (member_ids) order by 1) org;
  delete from turn_rollups rollup
   using unnest(member_ids, session_ids) touched (member_id, session_id)
   where rollup.member_id = touched.member_id
     and rollup.session_id = touched.session_id;
  perform sessclone_rollup_add(array(
    select turn from turns turn
      join unnest(member_ids, session_ids) touched (member_id, session_id)
        on turn.member_id = touched.member_id
       and turn.session_id = touched.session_id
  ));
end
$$;

create or replace function sessclone_turns_rollup_insert()
  returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform sessclone_rollup_add(array(select row(added.*)::turns from added_turns added));
  return null;
end
$$;

create or replace function sessclone_turns_rollup_change()
  returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform sessclone_rollup_recompute(array_agg(touched.member_id),
                                     array_agg(touched.session_id))
     from (select member_id, session_id from removed_turns
           union
           select member_id, session_id from changed_turns) touched;
  return null;
end
$$;

create or replace function sessclone_turns_rollup_delete()
  returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform sessclone_rollup_recompute(array_agg(touched.member_id),
                                     array_agg(touched.session_id))
     from (select distinct member_id, session_id from removed_turns) touched;
  return null;
end
$$;

create trigger turns_rollup_insert after insert on turns
  referencing new table as added_turns
  for each statement execute function sessclone_turns_rollup_insert();
create trigger turns_rollup_update after update on turns
  referencing old table as removed_turns new table as changed_turns
  for each statement execute function sessclone_turns_rollup_change();
create trigger turns_rollup_delete after delete on turns
  referencing old table as removed_turns
  for each statement execute function sessclone_turns_rollup_delete();

-- Rebuilds one Org's rollups from `turns`, a batch of Turns at a time: one
-- array of every Turn would pass Postgres's 1 GB value limit at a few million
-- Turns. Batches may split a group; the add sums into it either way.
create or replace function sessclone_rollup_rebuild_org(org uuid)
  returns void
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
declare
  batch turns[];
  last_id bigint := 0;
begin
  perform pg_advisory_xact_lock(
            hashtextextended('sessclone_turn_rollups:' || org::text, 0));
  delete from turn_rollups where org_id = org;
  loop
    batch := array(
      select turn from turns turn
       where turn.org_id = org and turn.id > last_id
       order by turn.id limit 50000
    );
    exit when cardinality(batch) = 0;
    perform sessclone_rollup_add(batch);
    last_id := batch[cardinality(batch)].id;
  end loop;
end
$$;

-- An Org's timezone decides which local day each of its Turns is on.
create or replace function sessclone_orgs_rollup_timezone()
  returns trigger
  language plpgsql security definer
  set search_path = pg_catalog, public, pg_temp as $$
begin
  perform sessclone_rollup_rebuild_org(new.id);
  return null;
end
$$;

create trigger orgs_rollup_timezone after update of timezone on orgs
  for each row when (old.timezone is distinct from new.timezone)
  execute function sessclone_orgs_rollup_timezone();

-- Prices each rollup row as `turn_costs` prices a Turn: the same Rate
-- precedence, resolved once per (Org, model, local day) rather than per Turn.
-- `security_invoker`, so a viewer reads only rows and Rates their policies
-- allow, as through `turn_costs`.
create view turn_rollup_costs with (security_invoker = true) as
select
  rollup.*,
  case when flag.unpriced then null
  else
      coalesce(rollup.input_tokens * price.input_usd * rollup.multiplier
        / 1000000, 0)
    + coalesce(rollup.output_tokens * price.output_usd * rollup.multiplier
        / 1000000, 0)
    + coalesce(rollup.cache_read_input_tokens * price.cache_read_usd
        * rollup.multiplier / 1000000, 0)
    + coalesce(rollup.cache_creation_5m_input_tokens * price.cache_write_5m_usd
        * rollup.multiplier / 1000000, 0)
    + coalesce(rollup.cache_creation_1h_input_tokens * price.cache_write_1h_usd
        * rollup.multiplier / 1000000, 0)
    + coalesce(rollup.web_search_requests * price.web_search_usd / 1000, 0)
    + coalesce(rollup.web_fetch_requests * price.web_fetch_usd / 1000, 0)
  end as cost_usd,
  flag.unpriced,
  case when flag.unpriced then rollup.turns else 0 end as unpriced_turns
from turn_rollups rollup
cross join lateral (
  select
    (array_agg(candidate.price_usd order by candidate.source_rank,
       candidate.model_rank desc, candidate.effective_from desc)
       filter (where candidate.class = 'input'))[1] as input_usd,
    (array_agg(candidate.price_usd order by candidate.source_rank,
       candidate.model_rank desc, candidate.effective_from desc)
       filter (where candidate.class = 'output'))[1] as output_usd,
    (array_agg(candidate.price_usd order by candidate.source_rank,
       candidate.model_rank desc, candidate.effective_from desc)
       filter (where candidate.class = 'cache_read'))[1] as cache_read_usd,
    (array_agg(candidate.price_usd order by candidate.source_rank,
       candidate.model_rank desc, candidate.effective_from desc)
       filter (where candidate.class = 'cache_write_5m'))[1]
       as cache_write_5m_usd,
    (array_agg(candidate.price_usd order by candidate.source_rank,
       candidate.model_rank desc, candidate.effective_from desc)
       filter (where candidate.class = 'cache_write_1h'))[1]
       as cache_write_1h_usd,
    (array_agg(candidate.price_usd order by candidate.source_rank,
       candidate.model_rank desc, candidate.effective_from desc)
       filter (where candidate.class = 'web_search_request'))[1]
       as web_search_usd,
    (array_agg(candidate.price_usd order by candidate.source_rank,
       candidate.model_rank desc, candidate.effective_from desc)
       filter (where candidate.class = 'web_fetch_request'))[1]
       as web_fetch_usd
  from (
    select override.class, override.price_usd, 1 as source_rank,
           (override.model is not null) as model_rank, override.effective_from
      from org_rate_overrides override
     where override.org_id = rollup.org_id
       and (override.model = rollup.model or override.model is null)
       and override.effective_from <= rollup.day
    union all
    select rate.class, rate.price_usd, 2,
           (rate.model is not null), rate.effective_from
      from rates rate
     where (rate.model = rollup.model or rate.model is null)
       and rate.effective_from <= rollup.day
  ) as candidate
) as price
cross join lateral (values (
  (rollup.shape & 128) <> 0
  or ((rollup.shape & 1) <> 0 and price.input_usd is null)
  or ((rollup.shape & 2) <> 0 and price.output_usd is null)
  or ((rollup.shape & 4) <> 0 and price.cache_read_usd is null)
  or ((rollup.shape & 8) <> 0 and price.cache_write_5m_usd is null)
  or ((rollup.shape & 16) <> 0 and price.cache_write_1h_usd is null)
  or ((rollup.shape & 32) <> 0 and price.web_search_usd is null)
  or ((rollup.shape & 64) <> 0 and price.web_fetch_usd is null)
)) as flag (unpriced);

grant select on turn_rollup_costs to sessclone_app;

-- Only the triggers call these, and a trigger needs no EXECUTE grant to fire.
-- Postgres grants EXECUTE to PUBLIC on every new function, so take it back:
-- a definer helper callable by anyone writes what it writes for anyone.
revoke execute on function sessclone_rollup_rows(turns[]) from public;
revoke execute on function sessclone_rollup_add(turns[]) from public;
revoke execute on function sessclone_rollup_recompute(uuid[], text[]) from public;
revoke execute on function sessclone_rollup_rebuild_org(uuid) from public;
revoke execute on function sessclone_turns_rollup_insert() from public;
revoke execute on function sessclone_turns_rollup_change() from public;
revoke execute on function sessclone_turns_rollup_delete() from public;
revoke execute on function sessclone_orgs_rollup_timezone() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function sessclone_rollup_rows(turns[]) from anon;
    revoke execute on function sessclone_rollup_add(turns[]) from anon;
    revoke execute on function sessclone_rollup_recompute(uuid[], text[]) from anon;
    revoke execute on function sessclone_rollup_rebuild_org(uuid) from anon;
    revoke execute on function sessclone_turns_rollup_insert() from anon;
    revoke execute on function sessclone_turns_rollup_change() from anon;
    revoke execute on function sessclone_turns_rollup_delete() from anon;
    revoke execute on function sessclone_orgs_rollup_timezone() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function sessclone_rollup_rows(turns[]) from authenticated;
    revoke execute on function sessclone_rollup_add(turns[]) from authenticated;
    revoke execute on function sessclone_rollup_recompute(uuid[], text[]) from authenticated;
    revoke execute on function sessclone_rollup_rebuild_org(uuid) from authenticated;
    revoke execute on function sessclone_turns_rollup_insert() from authenticated;
    revoke execute on function sessclone_turns_rollup_change() from authenticated;
    revoke execute on function sessclone_turns_rollup_delete() from authenticated;
    revoke execute on function sessclone_orgs_rollup_timezone() from authenticated;
  end if;
end $$;

-- The two deployment-wide reads that grouped every Turn, over the rollups
-- instead. `create or replace` keeps their grants; the `set` clause is
-- restated because replacing a function drops it.
--
-- A Member's Projects: the distinct pairs are the same over the rollups,
-- which carry both columns, and there are far fewer rows to make them from.
create or replace function sessclone_own_turn_projects()
  returns table (member_id uuid, project_id uuid)
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select distinct rollup.member_id, rollup.project_id
    from turn_rollups rollup
   where rollup.member_id in (select sessclone_own_member_ids())
     and rollup.project_id is not null
$$;

-- The unpriced models. `20261002120000_unknown_models_by_shape.sql` priced one
-- Turn per shape to avoid pricing them all; a rollup row is already one
-- shape, so this prices each row once and needs no representative.
create or replace function sessclone_unknown_models()
  returns table (model text, turns bigint, last_seen_at timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select rollup.model, sum(rollup.turns)::bigint, max(rollup.last_at)
    from turn_rollup_costs rollup
   where rollup.unpriced
     and sessclone_is_platform_admin()
   group by rollup.model
   order by 2 desc, rollup.model
$$;

-- `projects_read` asks this on every read that names a Project, and it read
-- every visible Turn to find their distinct Projects: 0.24s of a 0.28s Sessions
-- page at 2M Turns, locally. The rollups carry every Turn's Project, so the set
-- is the same, read from far fewer rows through their own index.
create or replace function sessclone_visible_project_ids() returns setof uuid
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  select id from projects where org_id in (select sessclone_admin_org_ids())
  union
  select distinct project_id from turn_rollups
   where member_id in (select sessclone_visible_member_ids())
     and project_id is not null
  union
  select distinct project_id from log_artifacts
   where member_id in (select sessclone_visible_member_ids())
     and project_id is not null
$$;

-- Two index changes on `turns` itself. A Session's Turn list reads in
-- `occurred_at` order and pages by it; with this index a page is the next
-- hundred entries rather than a sort of the whole Session. And
-- `turns_member_project_idx` served only the two Project reads above, which
-- read the rollups now; an index nothing reads is a cost on every insert.
create index turns_session_occurred_at_idx
  on turns (member_id, session_id, occurred_at, id);
drop index turns_member_project_idx;

-- Every Turn already collected, an Org at a time.
select sessclone_rollup_rebuild_org(org.id) from orgs org order by org.id;
