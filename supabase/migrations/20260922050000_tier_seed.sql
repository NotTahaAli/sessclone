-- Ticket 80: the four Tiers as rows, so the public pricing page reads prices
-- rather than restating them.
--
-- They were copy in `apps/web/lib/tiers.ts` — settled on 2026-09-20 and
-- recorded in `docs/design/marketing-site.md` — which made the page a second
-- source of truth beside this table and the one that goes stale when an
-- operator edits a price on the admin page. The numbers move here unchanged.
--
-- `on conflict (key) do nothing`, so re-running this migration on a deployment
-- whose operator has since edited a price does not put the published figure
-- back. A seed states what a deployment starts with, not what it must keep.
--
-- `features.includes` is the card's prose, as an array of lines. It is data
-- for the same reason every other gate is (ADR 0004): a tier that starts
-- including something new is an edit on the admin page, not a deploy.
insert into tiers (key, name, description, base_price_usd, seat_price_usd,
                   included_seats, min_seats, max_seats, retention_max_days,
                   archival_available, features, sort_order, available)
values
  ('self_hosted', 'Self-Hosted', 'Run it yourself, free, at any size.',
   0, 0, 0, null, null, null, true,
   jsonb_build_object('includes', jsonb_build_array(
     'Every feature, no seat limit',
     'Your database, your storage, your network',
     'The panel''s licence notice and sessclone credit stay visible',
     'AGPL: run a modified copy for others, offer them its source')),
   0, true),
  ('personal', 'Personal', 'One person, every machine they run Claude Code on.',
   5, null, 1, 1, 1, 90, false,
   jsonb_build_object('includes', jsonb_build_array(
     'Unlimited Devices and Projects',
     'Cost per Session, Project and Device',
     '90 days of history')),
   1, true),
  ('team', 'Team', 'A team that wants one number for all of it.',
   null, 10, 0, 2, 10, 365, true,
   jsonb_build_object('manager_scopes', true, 'includes', jsonb_build_array(
     'Everything in Personal, per Member',
     'Roles: Owner, Admin, Manager, Member',
     'Manager Scopes, so a lead sees their own people',
     'A year of history')),
   2, true),
  ('enterprise', 'Enterprise', 'Eleven seats and up, or terms of your own.',
   null, null, 0, 11, null, null, true,
   jsonb_build_object('manager_scopes', true, 'sso', true,
     'includes', jsonb_build_array(
     'Everything in Team, with no seat ceiling',
     'Negotiated per-model rates',
     'Retention set to your own policy',
     'Single sign-on and an invoice')),
   3, true)
on conflict (key) do nothing;
