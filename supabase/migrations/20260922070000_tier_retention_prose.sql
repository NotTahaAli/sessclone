-- The retention ceiling is a column, so the cards stop repeating it as prose.
--
-- `features.includes` carried "90 days of history" and "A year of history"
-- beside `retention_max_days`, which is the second source of truth ticket 80
-- exists to delete — one that is harder to notice for having moved out of
-- TypeScript and into jsonb. An operator raising Team's ceiling to two years
-- on /admin/tiers would have changed what an Org may keep and left the
-- pricing page saying "A year" forever.
--
-- The card now renders the column (`tierRetention` in apps/web/lib/tiers.ts),
-- so these lines are dropped from every Tier that still carries one. Written
-- as a filter over whatever the array holds rather than as four replacements:
-- an operator may have edited these since the seed ran.
update tiers
   set features = jsonb_set(
         features,
         '{includes}',
         coalesce(
           (select jsonb_agg(line)
              from jsonb_array_elements_text(features -> 'includes') as line
             where line !~* '(day|year|month)s? of history'),
           '[]'::jsonb
         )
       )
 where jsonb_typeof(features -> 'includes') = 'array'
   and exists (
     select 1 from jsonb_array_elements_text(features -> 'includes') as line
      where line ~* '(day|year|month)s? of history'
   );
