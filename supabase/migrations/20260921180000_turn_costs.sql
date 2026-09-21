-- Ticket 42: an estimated Cost for any Turn.
--
-- ADR 0002 is the whole specification. Cost is derived when it is read, never
-- stored, so this migration adds no column to `turns` and no table beside it —
-- only the arithmetic, as two views and two functions. Adding a Rate reprices
-- history from the next read, because there is nothing to backfill.
--
-- Four things had to be decided, and each is written down where it is used:
-- how a rate's period is bounded, how the three modifiers apply, what an
-- unpriced Turn resolves to, and why this is a view rather than a function
-- called per row.

-- ---------------------------------------------------------------------------
-- The modifiers
-- ---------------------------------------------------------------------------

-- The generation of a model, as a number, so `4.6 and later` is a comparison
-- rather than a list somebody has to remember to extend.
--
-- Claude model ids are `claude-<family>-<major>[-<minor>][-<snapshot>]`, and
-- every id in the seed parses: `claude-sonnet-5` is 5, `claude-fable-5-1` is
-- 5.1, and `claude-opus-4-5-20251101` is 4.5 with the dated snapshot ignored.
-- Anything else — a Bedrock id, a Vertex id, `<synthetic>`, null — is null,
-- and a null generation fails every comparison below, so an id this cannot
-- read is an id that gets no modifier rather than the wrong one.
--
-- Two `substring`s and no `from` clause, deliberately: Postgres inlines a
-- scalar SQL function only when its body has none, and this one is called per
-- Turn. `sessclone_resolve_rate` is the counter-example — it cannot inline,
-- which is why it is not what the view below uses.
create or replace function sessclone_model_generation(model_id text)
  returns numeric
  language sql immutable parallel safe as $$
  select substring(model_id from '^claude-[a-z]+-(\d+)')::numeric
       + coalesce(
           substring(model_id from '^claude-[a-z]+-\d+-(\d{1,2})(?:$|-)')::numeric,
           0
         ) / 10
$$;

-- What the three modifiers in ADR 0002 multiply a resolved rate by, together.
--
--   - **Fast mode** doubles the rate, on Opus 4.8 and later. The ADR names
--     "Opus 5 and Opus 4.8", which is that comparison; written as a
--     comparison, an Opus released next month is covered without a migration.
--     A fast-mode session priced at standard rates is understated by half.
--   - **US-only inference** is 1.1x across every class, on 4.6 and later.
--   - **The batch tier** is the Batch API's 50% discount.
--
-- They multiply rather than being classes in the rate table: as classes they
-- would need a row per combination per model, which is the same price written
-- eight times (the rates migration says so in as many words).
--
-- Every branch falls through to 1, so an unrecognised `speed`, a null
-- `inference_geo` and a `service_tier` this deployment has never seen all
-- leave the rate exactly as the table has it. That is the safe direction: a
-- missing modifier understates or overstates by a known factor, while a
-- guessed one is a number nobody can re-derive.
create or replace function sessclone_price_multiplier(
  model_id text,
  speed text,
  inference_geo text,
  service_tier text
) returns numeric
  language sql immutable parallel safe as $$
  select case
           when speed = 'fast'
            and model_id like 'claude-opus-%'
            and sessclone_model_generation(model_id) >= 4.8 then 2
           else 1
         end
       * case
           when inference_geo = 'us'
            and sessclone_model_generation(model_id) >= 4.6 then 1.1
           else 1
         end
       * case when service_tier = 'batch' then 0.5 else 1 end
$$;

-- ---------------------------------------------------------------------------
-- The rate a Turn falls in
-- ---------------------------------------------------------------------------

-- Every rate as a half-open period rather than a start date.
--
-- `sessclone_resolve_rate` answers "which rate was live on this date" one
-- lookup at a time, which is right for the platform admin surface and wrong
-- here: it is not inlinable, and seven classes times an Org's Turns is
-- hundreds of thousands of calls for one chart. `lead(effective_from)` turns
-- the same precedence rule into a range a join can use, so the rates are
-- resolved once for the whole query and every Turn finds its row by
-- comparison.
--
-- The partitions are what keep the precedence intact. An override's periods
-- are bounded by other overrides *for that Org*, and a model-specific row's by
-- other rows for that model — so a null-model row expiring never silently
-- extends a model-specific one, and the ranking below still chooses between
-- the candidates rather than depending on the windowing to have excluded them.
--
-- `security_invoker` because a view otherwise reads with its *owner's* rights,
-- and the owner here is the role that owns the tables, which Postgres exempts
-- from every policy. Without it this view would be a hole straight through
-- `org_rate_overrides_read`: one Org's negotiated pricing, readable by every
-- other Org on the deployment.
create view rate_periods with (security_invoker = true) as
  select
    null::uuid as org_id,
    model,
    class,
    price_usd,
    effective_from,
    lead(effective_from) over (
      partition by model, class order by effective_from
    ) as effective_until,
    -- The platform table loses to an Org's own negotiated price.
    2 as source_rank
  from rates
union all
  select
    org_id,
    model,
    class,
    price_usd,
    effective_from,
    lead(effective_from) over (
      partition by org_id, model, class order by effective_from
    ),
    1
  from org_rate_overrides;

comment on view rate_periods is
  'Every Rate as a half-open [effective_from, effective_until) period, so a '
  'query resolves rates once and joins rather than calling '
  'sessclone_resolve_rate per row. Ticket 42.';

-- ---------------------------------------------------------------------------
-- The cost of a Turn
-- ---------------------------------------------------------------------------

-- One row per Turn, and deliberately nothing else on it: `turn_id`, the
-- estimate, and whether there was one. A wider view would mean either a second
-- scan of `turns` or seven copies of every column it carried, and the callers
-- (tickets 43 and 52 onwards) are already selecting from `turns` — they join
-- this to it.
--
-- `security_invoker` again, and here it is load-bearing twice over: `turns`
-- carries the read policy that decides whose usage a Member may see, and a
-- view that bypassed it would hand every Org's spend to anyone signed in.
-- `apps/web/test/rls.test.ts` and the costs suite both read this as an
-- unprivileged role for that reason.
create view turn_costs with (security_invoker = true) as
with quantities as (
  -- The seven priced quantities of a Turn, one row each. `cross join lateral
  -- (values …)` is a rewrite of the row, not a function call per class, so
  -- this costs a scan rather than a loop.
  --
  -- `thinking_tokens` is absent because it is a subset of `output_tokens`, and
  -- `cache_creation_input_tokens` because it is the reported *total* whose
  -- split is already priced above it — counting either would bill the same
  -- tokens twice.
  select
    turn.id,
    turn.org_id,
    turn.model,
    -- The day the Turn ran, which is what a Rate is effective from. In UTC:
    -- the Org timezone is ticket 51, and bucketing a Turn into the Org's own
    -- day is that ticket's to apply here once it exists.
    (turn.occurred_at at time zone 'UTC')::date as on_date,
    sessclone_price_multiplier(
      turn.model, turn.speed, turn.inference_geo, turn.service_tier
    ) as multiplier,
    priced.class,
    priced.quantity
  from turns turn
  cross join lateral (values
    ('input'::rate_class, turn.input_tokens),
    ('output', turn.output_tokens),
    ('cache_read', turn.cache_read_input_tokens),
    ('cache_write_5m', turn.cache_creation_5m_input_tokens),
    ('cache_write_1h', turn.cache_creation_1h_input_tokens),
    ('web_search_request', turn.web_search_requests),
    ('web_fetch_request', turn.web_fetch_requests)
  ) as priced (class, quantity)
),
resolved as (
  -- The winning Rate for each (Turn, class), by the precedence the rates
  -- migration wrote down: an Org override beats the platform table, a row
  -- naming the model beats a model-independent one, and the period containing
  -- the date settles the rest. `distinct on` with that `order by` is those
  -- three rules, applied in that order.
  --
  -- `left join`, so a class with no Rate survives as a null price rather than
  -- disappearing — which is the difference between an unpriced Turn and a Turn
  -- that looks free.
  select distinct on (quantities.id, quantities.class)
    quantities.id,
    quantities.class,
    quantities.quantity,
    quantities.multiplier,
    rate.price_usd
  from quantities
  left join rate_periods rate
    on rate.class = quantities.class
   and (rate.model = quantities.model or rate.model is null)
   and (rate.org_id is null or rate.org_id = quantities.org_id)
   and rate.effective_from <= quantities.on_date
   and (rate.effective_until is null or rate.effective_until > quantities.on_date)
  order by
    quantities.id,
    quantities.class,
    rate.source_rank,
    (rate.model is not null) desc,
    rate.effective_from desc
)
select
  resolved.id as turn_id,
  -- Null, never zero, when anything the Turn actually consumed has no Rate.
  -- ADR 0002: "Zero understates an Org's total while looking authoritative,
  -- which is the worst failure available to a number about money." A class the
  -- Turn consumed nothing of is not a gap — an unpriced rate on a zero counter
  -- contributes nothing either way.
  case
    when bool_or(resolved.price_usd is null and resolved.quantity > 0)
      then null
    else sum(
      resolved.quantity
      * resolved.price_usd
      * resolved.multiplier
      -- The unit follows from the class, as `sessclone_rate_unit` says: the
      -- five token classes are per million tokens, the two request classes per
      -- thousand requests.
      / case
          when sessclone_rate_unit(resolved.class) = 'per_krequests'
            then 1000
          else 1000000
        end
    )
  end as cost_usd,
  -- What the dashboard counts and labels rather than hiding: a Turn that is
  -- real usage with an unknown cost (`docs/design/dashboard-wireframes.md`,
  -- "Unpriced turns").
  bool_or(resolved.price_usd is null and resolved.quantity > 0) as unpriced
from resolved
group by resolved.id;

comment on view turn_costs is
  'The estimated Cost of each Turn, derived at read time from Usage, Rates '
  'and the three modifiers (ADR 0002). cost_usd is null — never zero — when '
  'a quantity the Turn consumed has no Rate. Ticket 42.';

-- Read only, and only what a policy already governs. Neither view is writable
-- and neither needs to be: a price change is a row in `rates`.
grant select on rate_periods, turn_costs to sessclone_app;
