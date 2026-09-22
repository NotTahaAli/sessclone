# 84: List the Org's stored transcripts, not only your own

**What to build:** A surface where an Owner, an Admin or a Manager sees the transcripts stored across the Members they can see, and downloads one.

Ticket 60 built the download route, and `log_artifacts_read` already answers it for every Role entitled to the transcript. What is missing is the listing: the only place a Download link is rendered is a Member's own `/settings/you`, built on `storedSessions`, which filters on `sessclone_own_member_ids()`. So another Member's transcript is reachable by its id and is not browsable by anyone, which leaves stories 35 and 36 half-served.

The shape is `storedSessions` again over `sessclone_visible_member_ids()` with a Member column, reusing `StoredTranscripts`. Delete stays out of it: `log_artifacts_delete` is the Member's own rows alone (ADR 0005), so the listing an Admin reads has Download and no Delete.

**Blocked by:** 60.

**Status:** open

- [ ] An Owner and an Admin list every Member's stored transcripts in the Org
- [ ] A Manager lists the Members in their Scope and no others
- [ ] Each listed transcript is downloadable, and none is deletable from here
- [ ] Paginated, like the Member's own listing
