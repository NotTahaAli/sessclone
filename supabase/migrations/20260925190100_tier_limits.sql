-- Ticket 139's values (Taha, 2026-09-25), apart from the schema in
-- `20260925190000_history_and_deletion.sql` so `marketing-tiers.test.ts` can
-- re-apply them after the Tier seed, as a deployment has them.
--
-- Turn history: Personal 90 days, Team a year, Enterprise and Self-Hosted
-- unlimited (null). Only where unset, so re-running keeps an operator's edit.
update tiers set history_days = 90 where key = 'personal' and history_days is null;
update tiers set history_days = 365 where key = 'team' and history_days is null;

-- Team's transcript cap falls from a year to ninety days. Only lowered, so
-- an operator who already set it lower keeps theirs.
update tiers set retention_max_days = 90
 where key = 'team' and (retention_max_days is null or retention_max_days > 90);

-- Existing Orgs past their new ceiling come down to it. Checked on production
-- 2026-09-25: no Org was above 90 days and no transcript older than 90 days,
-- so this deletes nothing there.
update orgs org
   set retention_days = ceiling.days
  from (
    select subscription.org_id,
           coalesce(subscription.retention_max_days, tier.retention_max_days) as days
      from subscriptions subscription
      join tiers tier on tier.id = subscription.tier_id
     where subscription.status = 'active'
  ) ceiling
 where ceiling.org_id = org.id
   and ceiling.days is not null
   and org.retention_days > ceiling.days;
