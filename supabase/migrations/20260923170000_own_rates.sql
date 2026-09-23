-- Ticket 121: an Enterprise Org sets its own per-model rates.
--
-- Taha, 2026-09-23: sessclone bills per seat, so an Org's rates change only
-- the estimates its own Members read — lower rates cannot lower an invoice.
-- That removes the reason `org_rate_overrides_write` was the platform flag
-- alone ("an Owner who could write this table could halve their own
-- invoice"), for the Tiers that say so.
--
-- Additive, so it is safe while the previous code is still deployed: a second
-- write policy beside `org_rate_overrides_write` (policies are OR-ed, so the
-- platform admin keeps write), a feature flag on a Tier row, and a line of
-- card copy. Nothing is dropped.

-- The gate is data (ADR 0004): `features.own_rates` on the Org's Tier. On
-- for Enterprise here; an operator can switch it on for any other Tier from
-- the admin page without a migration.
update tiers
   set features = features || '{"own_rates": true}'::jsonb
 where key = 'enterprise';

-- The card's line, only where it still reads as seeded: an operator who
-- rewrote it keeps their wording (the tier seed's own rule).
update tiers
   set features = jsonb_set(features, '{includes,1}',
                            '"Per-model rates you set yourselves"'::jsonb)
 where key = 'enterprise'
   and features -> 'includes' ->> 1 = 'Negotiated per-model rates';

-- Owner or Admin of an Org whose Tier has `features.own_rates`, for their
-- own Org only. Rates are Org settings rather than billing, so an Admin is in
-- (`CONTEXT.md` excludes an Admin from billing alone). The Tier is read
-- through `subscriptions_read` and `tiers_read`, both of which let a Member
-- see their own Org's plan. Only while that plan is `active` or `past_due`
-- (`UNLOCKED_STATUSES` in `apps/web/lib/approval.ts`): an Org's own ask for a
-- Tier (ticket 118) is an `inactive` row, and an ask must not open what only
-- an approved plan includes — with `SIGNUP_APPROVAL=off` nothing else would
-- stop it.
create policy org_rate_overrides_own on org_rate_overrides for all
  using (
    org_id in (select sessclone_admin_org_ids())
    and exists (
      select 1 from subscriptions subscription
        join tiers tier on tier.id = subscription.tier_id
       where subscription.org_id = org_rate_overrides.org_id
         and subscription.status in ('active', 'past_due')
         and tier.features @> '{"own_rates": true}'::jsonb
    )
  )
  with check (
    org_id in (select sessclone_admin_org_ids())
    and exists (
      select 1 from subscriptions subscription
        join tiers tier on tier.id = subscription.tier_id
       where subscription.org_id = org_rate_overrides.org_id
         and subscription.status in ('active', 'past_due')
         and tier.features @> '{"own_rates": true}'::jsonb
    )
  );
