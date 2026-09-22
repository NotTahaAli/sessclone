-- Three functions resolve relations through whatever `search_path` their
-- caller happens to have, which `20260920120600_search_path.sql` decided this
-- schema does not do.
--
-- One of them it had already pinned. `create or replace function` does not
-- keep a function's `SET` clauses — it replaces the whole definition — so
-- `20260921120000_member_and_device_guards.sql` replacing
-- `sessclone_guard_device_columns` silently dropped the pin that migration had
-- put there, with nothing anywhere to say so. The other two arrived with
-- `turn_costs` and were never pinned at all.
--
-- None of the three is `security definer`, which is why the test that exists
-- did not see them: it asks only about definer functions, where an unpinned
-- path is an escalation. These run as their caller, so the worst case is
-- narrower — a caller with a hostile path gets a guard that read a forged
-- `devices`, or a price multiplier that resolved a forged table — but that is
-- still the guard failing open, and the ingest path runs these as the role
-- that owns the tables and bypasses policies.
--
-- `schema.test.ts` now asks the question of every `sessclone_` function rather
-- than the definer ones, so the next `create or replace` that drops a pin
-- fails CI rather than a database linter months later.

alter function sessclone_guard_device_columns()
  set search_path = pg_catalog, public, pg_temp;

alter function sessclone_model_generation(text)
  set search_path = pg_catalog, public, pg_temp;

alter function sessclone_price_multiplier(text, text, text, text)
  set search_path = pg_catalog, public, pg_temp;
