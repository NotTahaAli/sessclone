# 87: Transcripts as a destination, not a settings page

**What to build:** The transcript listings move out of settings and become a top-level destination.

Ticket 84 put the Org's stored transcripts at `/settings/transcripts` and ticket 59's opt-in put a Member's own at `/settings/you`. Both are things a person comes looking for — a transcript is evidence, wanted at the moment somebody asks what a session actually did — and settings is where a person goes to change something, not to find something.

One destination, `/transcripts`, with the two listings it already has behind it: your own, and the Members you can see when your Role reaches them (`reachesTeamTranscripts`). A Member with no team view sees their own and no empty second section. Delete stays where it is: `log_artifacts_delete` is a Member's own rows alone (ADR 0005), so the team listing has Download and no Delete, as ticket 84 built it.

The settings entries go; they are not left behind as duplicates, and `/settings/transcripts` redirects rather than 404s, since the link has been shipped.

The archival toggle — whether uploads happen at all — stays in Your settings. That is a change to make, not a thing to find.

**Blocked by:** 84, 85.

**Status:** done

- [x] `/transcripts` lists your own stored transcripts, and the team's when your Role reaches them
- [x] The settings entries are gone and `/settings/transcripts` is a 308 to the new destination, since the link has shipped
- [x] Download works for every listed transcript; Delete appears only on your own
- [x] The archival opt-in stays in Your settings, with one line pointing at the list
- [x] Screenshots at 1440x900 and 390x844, light and dark, in `/mnt/project-files/shots-tickets-85-88/`
