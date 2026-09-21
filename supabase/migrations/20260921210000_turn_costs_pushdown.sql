-- Ticket 81: the same Cost, at a shape a chart can filter.
--
-- `turn_costs` as ticket 42 left it fanned each Turn into seven rows, resolved
-- a Rate for each with `distinct on`, and folded them back with `group by
-- turn_id`. The arithmetic was right and the shape was not: the view exposed
-- only `turn_id`, so an Org chart's `org_id` and date range had nothing to
-- push into, and the aggregate was a barrier even once they did. A join from a
-- filtered `turns` priced every Turn on the deployment and then threw almost
-- all of it away. Measured on one box at 200k Turns, 100k of them in the
-- target Org, a 30-day Org chart took 21.9s.
--
-- Adding `org_id` and `occurred_at` as grouping columns is the obvious fix and
-- is not enough: it reached 17.1s, because the sevenfold fanout and the sort
-- behind `distinct on` remain whatever the quals do. So the shape changes
-- instead. One row per Turn throughout: the seven winning Rates are resolved
-- in a single lateral that yields seven columns, and the Cost is one scalar
-- expression over them. No fanout, no sort, no aggregate — the view is a plain
-- join over `turns`, so a qual on `org_id` or `occurred_at` lands on
-- `turns_org_occurred_at_idx` exactly as it would in a hand-written query.
--
-- Every number this produces is the number ticket 42 produced, with one
-- deliberate exception. The per-class division order is preserved so that
-- stays true, since `sum(q * p * m / 1e6)` and `sum(q * p * m) / 1e6` are not
-- the same numeric.
--
-- The exception: a Turn that consumed nothing, on a deployment where *no*
-- Rate matches its model and date at all — a Turn dated before every
-- `effective_from`, or a database with an empty rate table. Ticket 42's view
-- summed seven rows of `0 * null` and returned null while reporting
-- `unpriced` false, which is the one combination that means nothing: a cost
-- that is unknown and also not unpriced. This returns 0, which is what
-- `unpriced` false has always claimed. `costs.test.ts` pins it.
--
-- `rate_periods` is dropped below. It was the half-open view the old shape
-- joined, and with that shape gone it is a second, unread statement of the
-- rate precedence rule — the drift ADR 0002 spent its length avoiding. The
-- precedence now lives in `sessclone_resolve_rate` (one lookup) and in the
-- lateral here (a set), and nowhere else.
--
drop view turn_costs;
drop view rate_periods;

create view turn_costs with (security_invoker = true) as
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
  flag.unpriced
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
         sessclone_price_multiplier(
           turn.model, turn.speed, turn.inference_geo, turn.service_tier
         ) as multiplier
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

comment on view turn_costs is
  'The estimated Cost of each Turn, derived at read time from Usage, Rates '
  'and the three modifiers (ADR 0002). One row per Turn with org_id and '
  'occurred_at exposed, so an Org chart filters before it prices. cost_usd is '
  'null — never zero — when a quantity the Turn consumed has no Rate. '
  'Tickets 42 and 81.';

grant select on turn_costs to sessclone_app;
