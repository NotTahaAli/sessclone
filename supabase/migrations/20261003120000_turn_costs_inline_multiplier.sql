-- `turn_costs` stops calling a function per Turn.
--
-- `sessclone_price_multiplier` is pinned to a search path
-- (`20260922140000_search_path_repairs.sql`), and Postgres never inlines a
-- function with a `SET` clause: every call is a real call that saves and
-- restores the setting. The view called it once per Turn, and that call was
-- most of the cost of pricing anything. In production on 2026-10-03 the
-- Sessions list averaged 3.2s over 222 calls and reached 25s; `explain` put
-- the node holding that call at 0.36s of a 0.96s read of one Org's 21k Turns,
-- before row-level security, and every Costs read pays it too.
--
-- So the view spells the multiplier out instead. A view binds its functions
-- and operators when it is created, not through the caller's path, so the
-- inline expression needs no pin. The `case`s are nested so that a Turn whose
-- speed is not `fast` or whose geo is not `us` never reaches
-- `sessclone_model_generation` (pinned as well, and a regex): `null = 'fast'
-- and …` is not false, so a flat `and` chain evaluated the generation for
-- every Turn with a null speed. Measured locally on 21k Turns, pricing them
-- went from 0.85s to 0.09s as `sessclone_app`, and the Sessions list over them
-- from 1.0s to 0.19s.
--
-- `sessclone_price_multiplier` stays the definition of record, and its
-- comments are where the three modifiers are explained. It is still what the
-- single-Turn breakdown calls, and `costs.test.ts` fails if this expression
-- and that function ever disagree.
--
-- Otherwise this is `20260921210000_turn_costs_pushdown.sql`'s view with one
-- column added at the end, so `create or replace` keeps every grant and every
-- dependent read. Its comments are there.

create or replace view turn_costs with (security_invoker = true) as
select
  turn.id as turn_id,
  -- The two columns the whole ticket is about. A caller filters on these and
  -- Postgres pushes the quals down to `turns` before a single Rate is read.
  turn.org_id,
  turn.occurred_at,
  -- Null, never zero, when anything the Turn actually consumed has no Rate.
  -- ADR 0002: "Zero understates an Org's total while looking authoritative,
  -- which is the worst failure available to a number about money." A class the
  -- Turn consumed nothing of is not a gap, which is what the `coalesce`es
  -- below say: an absent Rate on a zero counter contributes nothing either
  -- way, and an absent Rate on a non-zero one has already made the Turn
  -- unpriced.
  case
    when flag.unpriced then null
    else
      coalesce(
        turn.input_tokens * price.input_usd * day.multiplier / 1000000, 0
      )
      + coalesce(
        turn.output_tokens * price.output_usd * day.multiplier / 1000000, 0
      )
      + coalesce(
        turn.cache_read_input_tokens * price.cache_read_usd * day.multiplier
          / 1000000, 0
      )
      + coalesce(
        turn.cache_creation_5m_input_tokens * price.cache_write_5m_usd
          * day.multiplier / 1000000, 0
      )
      + coalesce(
        turn.cache_creation_1h_input_tokens * price.cache_write_1h_usd
          * day.multiplier / 1000000, 0
      )
      -- The two server-tool classes are priced per thousand requests and are
      -- model-independent, so neither the divisor nor the modifiers match the
      -- five above. `sessclone_rate_unit` remains the definition of record and
      -- `apps/web/test/costs.test.ts` fails if these divisors drift from it.
      + coalesce(turn.web_search_requests * price.web_search_usd / 1000, 0)
      + coalesce(turn.web_fetch_requests * price.web_fetch_usd / 1000, 0)
  end as cost_usd,
  -- What the dashboard counts and labels rather than hiding (ticket 43).
  flag.unpriced,
  -- Last, because `create or replace` may only add columns at the end. The
  -- token breakdown reads it rather than calling the function per Turn.
  day.multiplier
from turns turn
-- The day the Turn is priced on, in the Org's own timezone (ticket 51).
--
-- A Rate is effective from a date, and which date a 23:40 Turn falls on
-- depends on where the Org measures its days from. Reading `orgs.timezone`
-- here is what makes changing that setting re-bucket what is already
-- collected: `occurred_at` is an instant and nothing stored moves.
--
-- `left join` and a `coalesce`, so a Turn whose Org row is not readable prices
-- in UTC rather than vanishing. The column is `not null`, so the fallback is
-- about the policy on `orgs` and not about a missing value.
--
-- `offset 0` is an optimisation fence, and it is doing two jobs. Without it
-- Postgres flattens this into the target list, so `on_date` is recomputed for
-- every reference — and, worse, the Memoize below then keys on the raw
-- `occurred_at` rather than on the date, which turns 30 distinct cache keys
-- into one per hour. Measured at 200k Turns it was the difference between 720
-- cache misses and 30.
left join orgs org on org.id = turn.org_id
cross join lateral (
  select (turn.occurred_at at time zone coalesce(org.timezone, 'UTC'))::date
           as on_date,
         -- `sessclone_price_multiplier`, spelled inline. See the header.
         case
           when turn.speed = 'fast' then
             case
               when turn.model like 'claude-opus-%'
                and turn.model not like '%@%'
                and sessclone_model_generation(turn.model) >= 4.08 then 2
               else 1
             end
           else 1
         end
       * case
           when turn.inference_geo = 'us' then
             case
               when turn.model not like '%@%'
                and sessclone_model_generation(turn.model) >= 4.06 then 1.1
               else 1
             end
           else 1
         end
       * case when turn.service_tier = 'batch' then 0.5 else 1 end
           as multiplier
   offset 0
) as day
-- The seven winning Rates, as seven columns of one row.
--
-- The precedence is the rates migration's, unchanged: an Org override beats
-- the platform table, a row naming the model beats a model-independent one,
-- and the latest `effective_from` on or before the date settles the rest. It
-- is one `order by` inside `array_agg`, and `filter` splits the candidates by
-- class — so the three-key sort happens once over a handful of rows rather
-- than once per (Turn, class) pair.
--
-- `[1]` on an empty array is null rather than an error, which is the case that
-- matters: a class with no Rate at all has to survive as null, or an unpriced
-- Turn becomes a free one.
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
    -- Read straight from the two tables rather than through `rate_periods`,
    -- whose `lead()` windows cannot be pushed under a correlated lateral.
    -- `org_rate_overrides_resolution_idx` is reachable on its leading
    -- `org_id`; `rates_resolution_idx` is not, because there is no `class`
    -- qual here — the class is consumed by the seven `filter`s above, so each
    -- Memoize miss scans `rates` whole. That is 82 rows on a seeded
    -- deployment and grows as models times classes times price revisions; the
    -- fix, when it matters, is to split this union per class rather than to
    -- add an index the `model is null` branch would defeat anyway.
    --
    -- Both tables carry row-level security and this view is
    -- `security_invoker`, so an Org's negotiated pricing is no more readable
    -- through here than it is directly.
    select override.class, override.price_usd, 1 as source_rank,
           (override.model is not null) as model_rank, override.effective_from
      from org_rate_overrides override
     where override.org_id = turn.org_id
       and (override.model = turn.model or override.model is null)
       and override.effective_from <= day.on_date
    union all
    select rate.class, rate.price_usd, 2,
           (rate.model is not null), rate.effective_from
      from rates rate
     where (rate.model = turn.model or rate.model is null)
       and rate.effective_from <= day.on_date
  ) as candidate
) as price
-- Usage that happened at a price this cannot name — counted and labelled, not
-- hidden and not silently zero. A reported cache-write total with no split is
-- the same thing: `packages/shared/src/turns.ts` says a capture may state the
-- total and no split, and pricing the shortfall at the 5m rate would be a
-- guess.
cross join lateral (values (
  turn.cache_creation_input_tokens
      > turn.cache_creation_5m_input_tokens
      + turn.cache_creation_1h_input_tokens
  or (turn.input_tokens > 0 and price.input_usd is null)
  or (turn.output_tokens > 0 and price.output_usd is null)
  or (turn.cache_read_input_tokens > 0 and price.cache_read_usd is null)
  or (turn.cache_creation_5m_input_tokens > 0
      and price.cache_write_5m_usd is null)
  or (turn.cache_creation_1h_input_tokens > 0
      and price.cache_write_1h_usd is null)
  or (turn.web_search_requests > 0 and price.web_search_usd is null)
  or (turn.web_fetch_requests > 0 and price.web_fetch_usd is null)
)) as flag (unpriced);
