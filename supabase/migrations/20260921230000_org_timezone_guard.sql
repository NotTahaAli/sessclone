-- Ticket 51, corrected in review: the guard was weaker than the rule it was
-- written to enforce.
--
-- The column's own migration says an Org must store a name from the timezone
-- database and never a fixed offset, "because `America/New_York` knows about
-- daylight saving and `-05:00` does not". Checking membership in
-- `pg_timezone_names` does not say that. The database ships fixed offsets
-- under names — `EST`, `MST`, `HST`, `Factory`, and the whole `Etc/` tree —
-- and every one of them passed. `EST` is not New York: it is −05:00 all year,
-- so an Org that stored it would silently mis-bucket every Turn from March to
-- November, which is the failure the check exists to prevent.
--
-- The rule that was actually being enforced lived in `listTimezones`, in the
-- `<select>` the page renders. A rule in a control is not a rule: the Server
-- Action is a POST anybody may reach with any value the regex admits. So the
-- rule moves here, where the write is, and the query keeps the same shape so
-- that the list and the guard cannot disagree.
--
-- `UTC` is the exception and is the column's default: it is an offset, it has
-- no daylight-saving rule, and that is exactly why an Org may choose it.
create or replace function sessclone_guard_org_timezone() returns trigger
  language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.timezone <> 'UTC' and (
    -- A region/location name, which is the shape every zone with a
    -- daylight-saving rule takes.
    position('/' in new.timezone) = 0
    -- `Etc/GMT+5` has the shape and none of the meaning; `posix/` and
    -- `right/` are the same zones again under different leap-second rules.
    or new.timezone like 'Etc/%'
    or new.timezone like 'posix/%'
    or new.timezone like 'right/%'
  ) then
    raise exception 'not a region timezone: %', new.timezone
      using hint = 'use an IANA region name, such as Europe/London, or UTC';
  end if;

  if not exists (
    select 1 from pg_timezone_names where name = new.timezone
  ) then
    raise exception 'unknown timezone: %', new.timezone
      using hint = 'use an IANA name, such as Europe/London';
  end if;

  return new;
end
$$;
