# 139: A Turn history window per Tier, and a transcript cap of its own

**What to build:** Taha, 2026-09-25: "I want a transcript retention time added to orgs as well. Personal can't have transcripts, Team has up to 90 days … Enterprise is up to contract." The existing retention (ticket 61) was already transcript-only (`orgs.retention_days`, capped by `tiers.retention_max_days`), but the pricing card rendered that cap as "90 days of history" / "A year of history", which reads as Turn history. Turns were never limited.

**What was picked (Taha's decisions, 2026-09-25).**

1. **Two limits per Tier.** A Turn history window (Personal 90 days, Team 365, Enterprise and Self-Hosted unlimited) and the transcript cap (Personal none, Team 90, Enterprise per contract).
2. **The history window is display only.** Turns older than the window are hidden, never deleted (Turns are billing); an upgrade brings them back.
3. **Sessions and Costs both respect it.** A Session that straddles the edge is listed, but its detail and every total count only Turns inside the window, so totals always match the Costs page, with a note that older Turns are hidden by the plan.
4. **Enterprise's transcript cap is per Org**, a ceiling field on the Org's Admin page beside the agreed price. The Owner then picks any value up to it.
5. **Existing Orgs above the new Team cap are clamped to 90.** Checked on production 2026-09-25: no Org is above 90 days and no transcript is older than 90 days, so the clamp deletes nothing.
6. **Downgrading to a Tier without transcripts** stops uploads at once; existing transcripts stay 7 days, with a banner and a link to download them, then the sweep deletes them.

**Blocked by:** none

**Status:** done

- [x] `tiers.history_days` (null = unlimited), seeded Personal 90, Team 365; Team `retention_max_days` 365 to 90
- [x] `subscriptions.retention_max_days`, the per-Org ceiling, edited on the Admin Org page; the retention guard reads it before the Tier's
- [x] Every dashboard Turn read bounded by the window; straddling Sessions note
- [x] Sweep deletes a non-archival Org's transcripts 7 days after the Tier change; banner on Transcripts
- [x] Pricing card states both limits
