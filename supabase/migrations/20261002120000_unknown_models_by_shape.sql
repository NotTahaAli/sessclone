-- The unknown-model list prices one Turn per shape, not every Turn.
--
-- `sessclone_unknown_models` priced every Turn on the deployment to find the
-- unpriced ones. Its own comment set the ceiling at 2.5s for 200k Turns; in
-- production on 2026-10-02 it averaged 11.2s over 31 calls at 102k Turns, and
-- reached 21s, which is the Rates page sitting on its loading state.
--
-- Whether a Turn is unpriced depends on exactly two things: which Rates
-- resolve for it — its Org (overrides), its model, and its date in the Org's
-- timezone — and which of its counters are non-zero, plus the one cache-write
-- comparison `turn_costs` flags on its own. Turns agreeing on all of those are
-- priced or unpriced together, so one representative per group answers for
-- the group. Production had 1,229 groups for 102k Turns; the same read went
-- from 3.2s to 0.22s measured directly.
--
-- `turn_costs` still decides `unpriced`: this only chooses which Turns it is
-- asked about. The grouping is the one place that has to know what the rule
-- reads, so a new input to `turn_costs.unpriced` has to be added here too.
-- `rates-admin.test.ts` compares this against the every-Turn answer.
create or replace function sessclone_unknown_models()
  returns table (model text, turns bigint, last_seen_at timestamptz)
  language sql stable security definer
  set search_path = pg_catalog, public, pg_temp as $$
  -- The gate. A caller without the flag gets an empty set rather than an
  -- error: this is a list, and "nothing to price" and "not yours to see" look
  -- the same from outside on purpose.
  --
  -- `security definer` is what makes the read deployment-wide — `turn_costs`
  -- is `security_invoker`, so inside this function it reads as the owner, who
  -- is exempt from `turns_read`. That is precisely why the projection below
  -- is three columns and why the flag is checked in the same statement.
  with shape as (
    select turn.model, min(turn.id) as turn_id, count(*) as turns,
           max(turn.occurred_at) as last_seen_at
      from turns turn
      left join orgs org on org.id = turn.org_id
     group by turn.org_id, turn.model,
              (turn.occurred_at at time zone coalesce(org.timezone, 'UTC'))::date,
              turn.cache_creation_input_tokens
                > turn.cache_creation_5m_input_tokens
                + turn.cache_creation_1h_input_tokens,
              turn.input_tokens > 0,
              turn.output_tokens > 0,
              turn.cache_read_input_tokens > 0,
              turn.cache_creation_5m_input_tokens > 0,
              turn.cache_creation_1h_input_tokens > 0,
              turn.web_search_requests > 0,
              turn.web_fetch_requests > 0
  )
  select shape.model, sum(shape.turns)::bigint, max(shape.last_seen_at)
    from shape
    -- A lateral fenced with `offset 0`, not a join: as a join the planner is
    -- free to price every Turn first and hash-join the shapes to the result,
    -- which is the pass this exists to avoid, and with fresh statistics it
    -- sometimes does. Fenced, `turn_costs` is asked once per shape, by key.
   cross join lateral (
     select cost.unpriced
       from turn_costs cost
      where cost.turn_id = shape.turn_id
     offset 0
   ) as cost
   where cost.unpriced
     and sessclone_is_platform_admin()
   group by shape.model
   order by 2 desc, shape.model
$$;
