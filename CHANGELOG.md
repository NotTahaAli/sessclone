# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
