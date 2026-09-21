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
-- every id in the seed parses: `claude-sonnet-5` is 5.00, `claude-fable-5-1`
-- is 5.01, and `claude-opus-4-5-20251101` is 4.05 with the dated snapshot
-- ignored. The separator after the major and the minor is a character class
-- because two shapes spell it differently: a Vertex id ends `@20260101`, and
-- a context-window suffix is `claude-opus-5[1m]`. Both used to fall out as a
-- bare major or as null, which is a *generation* this reads wrong; whether a
-- given platform's Turns take a modifier is a separate question, settled in
-- `sessclone_price_multiplier` rather than by failing to parse.
--
-- Anything else — a Bedrock id, `<synthetic>`, null — is null, and a null
-- generation fails every comparison below, so an id this cannot read is an id
-- that gets no modifier rather than the wrong one.
--
-- The minor is hundredths rather than tenths, which is why the thresholds
-- below read 4.08 and 4.06. A minor is a counter and not a decimal: at tenths
-- a two-digit minor overflows into the next generation (`claude-opus-4-10`
-- would be 5.0), and at hundredths it orders correctly against 4.08 — which
-- is the comparison, and the only thing this number is for.
--
-- Two `substring`s and no `from` clause, deliberately: Postgres inlines a
-- scalar SQL function only when its body has none, and this one is called per
-- Turn. `sessclone_resolve_rate` is the counter-example — it cannot inline,
-- which is why it is not what the view below uses. That is also why neither
-- function here carries the `set search_path = public` that
-- `20260920120600_search_path.sql` pins on the rest: a `SET` clause blocks
-- inlining outright, and neither of these two reads a relation, so there is
-- nothing for a `pg_temp` table to shadow.
create or replace function sessclone_model_generation(model_id text)
  returns numeric
  language sql immutable parallel safe as $$
  select substring(model_id from '^claude-[a-z]+-(\d+)(?:[-@[]|$)')::numeric
       + coalesce(
           substring(
             model_id from '^claude-[a-z]+-\d+-(\d{1,2})(?:$|[-@[])'
           )::numeric,
           0
         ) / 100
$$;

-- What the three modifiers in ADR 0002 multiply a resolved rate by, together.
--
--   - **Fast mode** doubles the rate, on Opus 4.8 and later, on the
--     first-party API only. The ADR names "Opus 5 and Opus 4.8", which is that
--     comparison; written as a comparison, an Opus released next month is
--     covered without a migration. A fast-mode session priced at standard
--     rates is understated by half.
--   - **US-only inference** is 1.1x across every token class, on 4.6 and
--     later, on the first-party API only.
--   - **The batch tier** is the Batch API's 50% discount, which every platform
--     that offers the Batch API offers.
--
-- "First-party only" is the published page, read 2026-09-21: fast mode "is not
-- available on Claude Platform on AWS or partner-operated cloud platforms",
-- and for data residency "partner-operated platforms (Bedrock and Google
-- Cloud) have independent regional pricing". A Vertex id is a partner id —
-- `claude-opus-4-8@20260101` — so neither modifier applies to it, whatever its
-- generation parses to, and `@` in the id is what says so. Bedrock ids do not
-- start `claude-` at all and have no generation to compare.
--
-- "Every class" means every class the rate table prices *per model*. The two
-- server-tool classes are priced per thousand requests and model-independent
-- — the rate seed says $10 per 1,000 searches "whoever answered" — so a fast
-- Opus session must not turn a $10 search into a $20 one. The view below
-- applies this to the token classes only, which is where the values list says
-- so.
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
            and model_id not like '%@%'
            and sessclone_model_generation(model_id) >= 4.08 then 2
           else 1
         end
       * case
           when inference_geo = 'us'
            and model_id not like '%@%'
            and sessclone_model_generation(model_id) >= 4.06 then 1.1
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
-- That narrowness has a cost the charts will have to pay: the `group by` here
-- means a caller's `org_id` and date range cannot push into the view, so a
-- join from a filtered `turns` prices the whole deployment first. Measured on
-- one box at 200k Turns, a 30-day org chart takes 21.9s against 39ms for the
-- same arithmetic written inline. Ticket 81 carries the fix — one row per Turn
-- throughout, with the rates resolved into columns rather than into a
-- `distinct on` over seven rows per Turn — and is blocking ticket 52, which is
-- the first thing that would read this at that size.
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
  --
  -- The split is not always reported, though. `packages/shared/src/turns.ts`
  -- says so: an entry that states no split at all is zero against a non-zero
  -- total. Pricing that at the 5m rate would be a guess and pricing it at
  -- nothing is the $0-that-looks-authoritative ADR 0002 forbids, so the
  -- shortfall makes the Turn unpriced — `cache_split_missing` below.
  select
    turn.id,
    turn.org_id,
    turn.model,
    turn.cache_creation_input_tokens
      > turn.cache_creation_5m_input_tokens
      + turn.cache_creation_1h_input_tokens as cache_split_missing,
    -- The day the Turn ran, which is what a Rate is effective from. In UTC:
    -- the Org timezone is ticket 51, and bucketing a Turn into the Org's own
    -- day is that ticket's to apply here once it exists.
    (turn.occurred_at at time zone 'UTC')::date as on_date,
    sessclone_price_multiplier(
      turn.model, turn.speed, turn.inference_geo, turn.service_tier
    ) as multiplier,
    priced.class,
    priced.quantity,
    priced.per_unit,
    priced.modified
  from turns turn
  -- The class, its quantity, the unit its Rate is quoted in, and whether the
  -- three modifiers apply to it — spelled out here rather than derived per
  -- row. `sessclone_rate_unit` in `…_rates.sql` remains the definition of
  -- record for the unit, and `apps/web/test/costs.test.ts` fails if this list
  -- and that function ever disagree. It would answer the third column, but it
  -- is
  -- `parallel unsafe` and carries a `SET` clause, so calling it in the select
  -- list below would cost the whole query its parallel plan for a fact this
  -- list already knows.
  cross join lateral (values
    ('input'::rate_class, turn.input_tokens, 1000000, true),
    ('output', turn.output_tokens, 1000000, true),
    ('cache_read', turn.cache_read_input_tokens, 1000000, true),
    ('cache_write_5m', turn.cache_creation_5m_input_tokens, 1000000, true),
    ('cache_write_1h', turn.cache_creation_1h_input_tokens, 1000000, true),
    ('web_search_request', turn.web_search_requests, 1000, false),
    ('web_fetch_request', turn.web_fetch_requests, 1000, false)
  ) as priced (class, quantity, per_unit, modified)
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
    quantities.per_unit,
    quantities.cache_split_missing,
    case when quantities.modified then quantities.multiplier else 1 end
      as multiplier,
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
      or bool_or(resolved.cache_split_missing)
      then null
    else sum(
      resolved.quantity * resolved.price_usd * resolved.multiplier
        / resolved.per_unit
    )
  end as cost_usd,
  -- What the dashboard counts and labels rather than hiding: a Turn that is
  -- real usage with an unknown cost (`docs/design/dashboard-wireframes.md`,
  -- "Unpriced turns"). A reported cache-write total with no split is that
  -- same thing: usage that happened, at a price this cannot name.
  bool_or(resolved.price_usd is null and resolved.quantity > 0)
    or bool_or(resolved.cache_split_missing) as unpriced
from resolved
group by resolved.id;

comment on view turn_costs is
  'The estimated Cost of each Turn, derived at read time from Usage, Rates '
  'and the three modifiers (ADR 0002). cost_usd is null — never zero — when '
  'a quantity the Turn consumed has no Rate. Ticket 42.';

-- Read only, and only what a policy already governs. Neither view is writable
-- and neither needs to be: a price change is a row in `rates`.
grant select on rate_periods, turn_costs to sessclone_app;
