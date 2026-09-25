# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An Org switcher: the Org name at the top of the sidebar, or of the phone
  header, opens a list of your Orgs, including one still waiting for approval.
  The Org you pick is remembered on that device.
- Invitations in the dashboard: the switcher lists the ones sent to your
  signed-in address, with Accept and Decline, and keeps an expired one for a
  week so you can dismiss it. An Admin sees a declined invitation as declined
  and can invite the same person again.
- Leave an Org from the switcher. The only Owner is asked to make somebody
  else an Owner first.
- New Org, at the bottom of the switcher, which now always opens. It asks for
  a name and, where sign-up asks for one, a plan; the new Org waits for
  approval like a sign-up, or opens at once where approval is off. You can have one
  Org of your own waiting at a time. The waiting page carries the switcher
  too, so you can switch out of an Org that is waiting. It emails the platform
  admins the same way a sign-up does, and just as little: nothing with
  approval off, nothing once the Org is active.
- A read-only live demo, off unless `ENABLE_DEMO=true`: "Try the demo" beside sign-up
  on the landing and pricing pages opens two made-up Orgs with six invented
  people each and 60 days of generated usage and transcripts. Every page is
  visible and every save answers "This is a demo". A daily
  `/api/demo/refresh` keeps the window current. The demo's Costs and Sessions
  pages are cached per day, for the demo visitor only.
- Browser tests: the repo's first Playwright suite (`apps/web/e2e`, run with
  `pnpm --filter web e2e`) accepts an invitation from the Org switcher and
  starts a New Org from it. It signs in without a Supabase project and seeds
  a `*_test` database directly.
- `ENABLE_LANDING`, `ENABLE_DOCS` and `ENABLE_DEMO`, each `true` or `false`
  and off when unset, so a self-hosted copy serves only the dashboard. With
  the landing page off, `/` goes to sign-in or the dashboard and `/pricing` is
  a 404; the privacy and terms pages stay. With the docs off, `/docs` is a
  404 and docs links go to sessclone.com. A signed-in visit to `/` opens the
  dashboard, and the dashboard's logo links back to the landing page.
  Changing a flag needs a rebuild. **Before deploying:** set all three on
  Vercel, for Production and Preview (`true` for sessclone.com), and remove
  `DEMO`, which nothing reads any more; unset, the landing page, docs and demo
  are all off.
- A sign-in that Supabase sends to the bare site with `?code=` now continues
  to `/auth/callback` instead of stopping on the home page.
- `/.well-known/security.txt` (RFC 9116), pointing to GitHub private advisories
  and, when set, the deployment's contact address. Its expiry is always a
  year ahead.

### Removed

- The one-argument `sessclone_accept_invitation(text)`, kept only while the
  Org switcher deployed. Migration `20260925170000_drop_one_argument_accept.sql`
  drops it; nothing calls it.

### Fixed

- A hydration error on every dashboard page and on the waiting page: the Org
  switcher was nested inside the brand line's `<p>`.

- Someone in more than one Org saw every Org's Devices, Keys and transcripts
  on each Org's pages, and the oldest Org's appearance; they now show the Org
  you are in. Settings, Members, Keys and invitation forms refuse to act on an
  Org other than the one the page was opened for.

## [0.1.0] - 2026-09-25

The first public release.

### Added

- The Collector: a Claude Code plugin that reports each Turn from hooks,
  pushing from a per-transcript cursor with a retry queue, and working through
  `HTTPS_PROXY` and in cloud containers.
- Ingest: API-key-authenticated routes that record Turns, and archive
  transcripts, subagent sidecars and workflow journals straight to storage
  through presigned URLs.
- Costs: per-model token pricing, spend per Session, Project and Member, a
  cost drill-down, and an admin flow to fetch and review published pricing.
- Sessions: listing, search, archive and hide, last Turn and last message
  times, and a per-model token table.
- A transcript viewer that reads as a chat, with Finder-style columns for
  subagents and workflow runs, filters and presets, a per-message model and
  token breakdown, and downloads of stored transcripts.
- Chunked archival (ADR 0008): a growing transcript is stored as sealed ~1 MiB
  gzip chunks plus a raw tail, so a steady turn uploads only its new bytes.
  Older single-file transcripts and older Collectors keep working.
- API keys and Devices per Member.
- Orgs with Roles, invitations, team transcripts, display names, and branding
  (accent, theme, Org logo).
- Tiers and pricing: Personal, Team and Enterprise per seat, prices edited on
  the admin page and read live by the pricing page; paid tiers open as a
  waitlist, and new Orgs wait for an admin's approval (`SIGNUP_APPROVAL`).
- Separate sign-in and sign-up, with sign-up choosing a plan first.
- A marketing site and docs at `/docs`, in light and dark, with indexing,
  analytics and the contact address all driven by environment variables.
- Retention: an Org's window, capped by its Tier, enforced by a daily sweep.
- Self-hosting: a Dockerfile, `compose.yaml` and a guide, free at any size
  under AGPL-3.0-only with the additional term in `NOTICE.md`.

[Unreleased]: https://github.com/NotTahaAli/sessclone/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NotTahaAli/sessclone/releases/tag/v0.1.0
