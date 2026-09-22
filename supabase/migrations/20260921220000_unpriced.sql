-- Ticket 43: "cost unknown" is not "cost zero", and the read path has to be
-- able to say which.
--
-- `turn_costs` already answers it per Turn: `cost_usd` is null and `unpriced`
-- is true when a quantity the Turn actually consumed has no Rate (ADR 0002).
-- What is missing is the two questions asked *about a set* of Turns — how many
-- of them are unpriced, which the Org's own read path answers under its own
-- policies, and which model identifiers are responsible, which is the
-- operator's question and is deliberately not an Org's.
--
-- The count needs nothing here: `count(*) filter (where unpriced)` beside a
-- `sum(cost_usd)` is the whole of it, and `apps/web/lib/spend.ts` is where the
-- two are read together so a total can never be shown without its caveat.
--
-- The model list does need something, because no Role can answer it. A
-- platform administrator is outside every Org and `turns_read` gives them
-- nothing: the operator governs pricing for the deployment and has no business
-- reading anybody's usage. So this is the narrowest possible hole — model
-- identifiers and a count of the Turns carrying them, and no Org, Member,
-- Project, Session or token counter — opened only for the flag that is not a
-- Role.
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
  -- One pricing pass over every Turn on the deployment, which is what makes
  -- this the one read here that ticket 81's pushdown cannot help: there is no
  -- Org to filter to. Measured at 200k Turns it is 2.5s, which an operator
  -- page asked for occasionally can wear. The upgrade, when a deployment
  -- outgrows it, is to price one representative Turn per distinct
  -- (org, model, date, modifiers, which-counters-are-non-zero) shape rather
  -- than every Turn — a few dozen rows instead of millions. It is left undone
  -- because that grouping has to stay a superset of whatever decides
  -- `unpriced`, and a copy of that rule here is the drift ADR 0002 spent its
  -- length avoiding.
  select turn.model, count(*), max(turn.occurred_at)
    from turns turn
    join turn_costs cost on cost.turn_id = turn.id
   where cost.unpriced
     and sessclone_is_platform_admin()
   group by turn.model
   order by count(*) desc, turn.model
$$;

comment on function sessclone_unknown_models() is
  'The model identifiers the rate table cannot price, deployment-wide, for '
  'the platform admin surface (tickets 43 and 63). Empty for anyone without '
  'the platform flag. Deliberately carries no Org, Member or usage.';

-- Granted to the dashboard's role, which is how the admin page will call it.
-- The grant is not the authorisation: the flag check inside is.
grant execute on function sessclone_unknown_models() to sessclone_app;
