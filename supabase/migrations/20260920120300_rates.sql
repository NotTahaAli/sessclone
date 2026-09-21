-- Ticket 23: the pricing tables.
--
-- ADR 0002 keeps money out of `turns` entirely: a Turn stores Usage and the
-- fields that modify a price, and Cost is derived when it is read. These two
-- tables are what it is derived from. Adding a row here reprices history, and
-- correcting one fixes every past estimate from the next read.
--
-- Nothing seeds them. Ticket 41 does that, from published prices checked at
-- seed time, and records the date they were read.

-- Five token classes and two server-tool classes, in one enum rather than a
-- `unit` column beside a class, so a row cannot say `cache_read` and `per
-- request` at once. Which unit a class is priced in follows from the class:
-- the five token classes are per million tokens, the two request classes per
-- thousand requests, and `sessclone_rate_unit` below is where that is written
-- down once.
--
-- The three pricing modifiers — fast mode, US-only inference, the batch tier —
-- are deliberately not classes here. They multiply a resolved rate and are
-- fields on the Turn (ADR 0002); as classes they would need a row per
-- combination per model, which is the same price written eight times.
create type rate_class as enum (
  'input',
  'output',
  'cache_write_5m',
  'cache_write_1h',
  'cache_read',
  'web_search_request',
  'web_fetch_request'
);

create or replace function sessclone_rate_unit(class rate_class) returns text
  language sql immutable as $$
  select case class
    when 'web_search_request' then 'per_krequests'
    when 'web_fetch_request' then 'per_krequests'
    else 'per_mtok'
  end
$$;

-- The platform price list. `model` is null for a price that does not depend on
-- the model — web search is $10 per 1,000 searches whatever answered it — and
-- a row naming a model wins over a null one for that model, so a provider that
-- ever does charge differently is one row rather than a migration.
--
-- `numeric` rather than a float, and no scale: a cache read is $0.025 per MTok
-- on some models and rounding money at the storage layer is how an estimate
-- acquires a drift nobody can explain.
--
-- `effective_from` is a date, not a timestamp. Published prices change on a
-- day, the Turn's `occurred_at` is compared against it in the Org's own
-- timezone, and a timestamp here would invite a precision the source does not
-- have.
create table rates (
  id uuid primary key default gen_random_uuid(),
  model text check (model is null or length(btrim(model)) > 0),
  class rate_class not null,
  price_usd numeric not null check (price_usd >= 0),
  effective_from date not null,
  -- Where the figure came from and when it was read, because ADR 0002 says
  -- rates are maintained by reviewed migration and never scraped. A price with
  -- no provenance is a price nobody can re-check.
  source text,
  created_at timestamptz not null default now(),
  -- `nulls not distinct`, so the model-independent row for a class can exist
  -- only once per date rather than once per insert.
  unique nulls not distinct (model, class, effective_from)
);

-- The read this table exists for: every rate in force for a model on a date.
create index rates_resolution_idx on rates (class, effective_from desc);

-- An Org that has negotiated its own pricing. Parallel to `rates` rather than
-- a nullable `org_id` on it, so the platform list cannot be edited by writing
-- an Org id into it, and so the two carry different policies — which they do:
-- the platform list is readable by everyone, an override only inside its Org.
create table org_rate_overrides (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs (id) on delete cascade,
  model text check (model is null or length(btrim(model)) > 0),
  class rate_class not null,
  price_usd numeric not null check (price_usd >= 0),
  effective_from date not null,
  note text,
  created_at timestamptz not null default now(),
  unique nulls not distinct (org_id, model, class, effective_from)
);

create index org_rate_overrides_resolution_idx
  on org_rate_overrides (org_id, class, effective_from desc);

-- Precedence, written once so tickets 41, 42, 63 and 64 do not each invent it.
--
-- Four rules, applied in this order:
--
--   1. An Org override beats the platform table. That is what a negotiated
--      price means.
--   2. A row naming the model beats a model-independent row.
--   3. Among the rows that remain, the latest `effective_from` on or before
--      the date wins — so a Turn keeps the price that was live when it ran.
--   4. Nothing matching is `null`, never `0`. ADR 0002 is explicit: zero
--      understates a total while looking authoritative, which is the worst
--      failure available to a number about money.
--
-- `stable`, and **not** inlinable: Postgres inlines a scalar SQL function only
-- when its body has no `from` clause, and this one has a `union all` subquery.
-- Measured at roughly 26µs a call, so a page of Turns is fine and an Org-wide
-- aggregate is not — seven classes times a hundred thousand Turns is seven
-- hundred thousand calls. Tickets 42 and 43 resolve the rates a query needs
-- once and join to them; this function is for a single lookup, which is what
-- the platform admin surface and the tests want.
create or replace function sessclone_resolve_rate(
  org uuid,
  model_id text,
  class rate_class,
  on_date date
) returns numeric
  language sql stable as $$
  select price_usd from (
    select price_usd, 1 as source_rank,
           (override.model is not null) as model_rank, override.effective_from
      from org_rate_overrides override
     where override.org_id = org
       and (override.model = model_id or override.model is null)
       and override.class = sessclone_resolve_rate.class
       and override.effective_from <= on_date
    union all
    select price_usd, 2 as source_rank,
           (rate.model is not null) as model_rank, rate.effective_from
      from rates rate
     where (rate.model = model_id or rate.model is null)
       and rate.class = sessclone_resolve_rate.class
       and rate.effective_from <= on_date
  ) candidates
   order by source_rank, model_rank desc, effective_from desc
   limit 1
$$;

alter table rates enable row level security;
alter table org_rate_overrides enable row level security;

-- The price list is readable by anyone signed in. It has to be: every Cost the
-- dashboard shows is a join against it, and the figures are Anthropic's
-- published prices rather than anybody's secret.
create policy rates_read on rates for select
  using ((select sessclone_user_id()) is not null);

-- Writing is the operator's, and only the operator's (ticket 63). An Org Owner
-- governs one Org; global pricing is outside every Org, which is the whole
-- reason `is_platform_admin` is a flag on the user and not a fifth Role.
create policy rates_write on rates for all
  using ((select sessclone_is_platform_admin()))
  with check ((select sessclone_is_platform_admin()));

-- An override is visible inside its own Org and nowhere else — every Cost that
-- Org sees is derived from it, so hiding it from the Members whose numbers it
-- explains would buy nothing. Another Org cannot see that it exists.
create policy org_rate_overrides_read on org_rate_overrides for select
  using (
    org_id in (select sessclone_org_ids())
    or (select sessclone_is_platform_admin())
  );

-- Negotiated pricing is agreed with the operator, not set by the customer
-- (ticket 64 sits in the platform admin area). An Owner who could write this
-- table could halve their own invoice.
create policy org_rate_overrides_write on org_rate_overrides for all
  using ((select sessclone_is_platform_admin()))
  with check ((select sessclone_is_platform_admin()));

-- As in the app-role migration: a verb is granted only where a policy governs
-- it, so least privilege and a second lock are the same line.
grant select on rates, org_rate_overrides to sessclone_app;
grant insert, update, delete on rates to sessclone_app;
grant insert, update, delete on org_rate_overrides to sessclone_app;
