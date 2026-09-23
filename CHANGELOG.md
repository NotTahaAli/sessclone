# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Nothing is tagged yet. The first release will be **0.1.0**, cut at public
launch; everything below lands in it.

## [Unreleased]

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
- A transcript viewer that reads as a chat, with Finder-style columns and
  downloads of stored transcripts.
- API keys and Devices per Member.
- Orgs with Roles, invitations, team transcripts, display names, and branding
  (accent, theme, Org logo).
- Retention: an Org's window, capped by its Tier, enforced by a daily sweep.
- Self-hosting: a Dockerfile, `compose.yaml` and a guide, free at any size
  under AGPL-3.0-only with the additional term in `NOTICE.md`.

[Unreleased]: https://github.com/NotTahaAli/sessclone/commits/main
