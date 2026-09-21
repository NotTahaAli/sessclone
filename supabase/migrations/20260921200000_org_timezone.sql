-- Ticket 51: the timezone an Org's days are measured in.
--
-- A chart is a pile of Turns cut into days, and where the cut falls is a
-- decision somebody has to make. Left to each reader's browser, the same chart
-- reports different numbers to two people in one Org and neither is wrong,
-- which is the failure this column exists to prevent: one Org, one definition
-- of a day, and every query that buckets reads it from here.
--
-- Stored on the Org and applied at read time, so changing it re-buckets what
-- is already collected rather than rewriting a single stored row. `turns` keeps
-- `occurred_at` as a `timestamptz` — an instant, with no timezone in it — and
-- that is what makes the change free.
alter table orgs
  add column timezone text not null default 'UTC'
    check (length(btrim(timezone)) > 0);

-- UTC, and deliberately not a guess.
--
-- The tempting default is the browser timezone of whoever happened to sign up
-- first, which decides what every later Member's chart means without anybody
-- choosing it, and silently disagrees with the invoice. UTC is the one answer
-- that is wrong in a way a reader notices immediately and an Owner can fix in
-- one control.
comment on column orgs.timezone is
  'The timezone this Org''s days are measured in (ticket 51). An IANA name '
  'from pg_timezone_names; applied at read time, never stored on a Turn.';

-- A name from the timezone database, not an offset.
--
-- `America/New_York` knows about daylight saving and `-05:00` does not, so an
-- Org that stored an offset would have two hours of every spring land in the
-- wrong day, once a year, forever. `at time zone` accepts both, which is why
-- this is checked against `pg_timezone_names` rather than by trying the cast.
--
-- A trigger rather than a `check` constraint: `pg_timezone_names` is a view
-- over the installed timezone database and is `stable` at best, so a check
-- constraint over it would be a lie about immutability that Postgres would
-- believe. The cost is one lookup on a write nobody makes often.
create or replace function sessclone_guard_org_timezone() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if not exists (
    select 1 from pg_timezone_names where name = new.timezone
  ) then
    raise exception 'unknown timezone: %', new.timezone
      using hint = 'use an IANA name, such as Europe/London';
  end if;
  return new;
end
$$;

create trigger orgs_guard_timezone
  before insert or update of timezone on orgs
  for each row execute function sessclone_guard_org_timezone();

-- Who may set it is already settled and is not restated here: `orgs_write`
-- (ticket 21) is Owner or Admin, which is what `docs/design/product-ia.md`
-- gives Org settings. A Manager or a Member reaching the row gets the same
-- refusal they would get for the Org's name.
