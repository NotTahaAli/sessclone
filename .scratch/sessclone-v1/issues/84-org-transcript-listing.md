# 84: List the Org's stored transcripts, not only your own

**What to build:** A surface where an Owner, an Admin or a Manager sees the transcripts stored across the Members they can see, and downloads one.

Ticket 60 built the download route, and `log_artifacts_read` already answers it for every Role entitled to the transcript. What is missing is the listing: the only place a Download link is rendered is a Member's own `/settings/you`, built on `storedSessions`, which filters on `sessclone_own_member_ids()`. So another Member's transcript is reachable by its id and is not browsable by anyone, which leaves stories 35 and 36 half-served.

The shape is `storedSessions` again over `sessclone_visible_member_ids()` with a Member column, reusing `StoredTranscripts`. Delete stays out of it: `log_artifacts_delete` is the Member's own rows alone (ADR 0005), so the listing an Admin reads has Download and no Delete.

**Blocked by:** 60.

**Status:** done

- [x] An Owner and an Admin list every Member's stored transcripts in the Org
- [x] A Manager lists the Members in their Scope and no others
- [x] Each listed transcript is downloadable, and none is deletable from here
- [x] Paginated, like the Member's own listing

## What landed

- `storedProjects` and `storedSessions` take an `Audience` (`own` or `team`).
  `team` asks for `sessclone_visible_member_ids()`, so an Owner and an Admin
  get every Member, a Manager gets their Scope, and a Manager with an empty
  Scope gets nothing — the statement names no Role and the policy is still the
  rule (ADR 0001). Both listings now carry the Member's address, left joined
  rather than inner so a listing never silently drops a transcript it is
  allowed to show.
- `/settings/transcripts`, a third Settings destination present for Owner,
  Admin and Manager and absent for a Member, whose own transcripts are on Your
  settings. It renders the same component with `audience="team"`, which names
  the Member each group belongs to and carries **no Delete control at all**:
  `log_artifacts_delete` is the Member's own rows alone (ADR 0005), so a
  button an Admin can see and never use is a button that lies.
- Tests in `apps/web/test/artifacts.test.ts`, as the unprivileged role: each
  Role's team listing (including the empty Scope and another Org), the Member
  address on a group, a removed Member's transcripts still in the Org's
  listing, and — the one a mistake here would be worst — Your settings staying
  the viewer's own rows whatever Role they hold, since every row on that page
  carries a Delete button. Verified red in both directions by swapping the two
  member-id functions.

Shots: `/tmp/claude-0/shots-84/` — the new page, the Settings index and Your
settings, desktop and phone, both themes.

## Acted on after review

- **A group is the unit, so nothing is browsable-by-nobody.** The first
  version was one flat Org-wide page of the 100 newest uploads, which on a
  read-only page is a dead end: in an Org with more stored sessions than that,
  most groups rendered as a header and a count with no Download link anywhere.
  The page now lists the groups and each group opens its own Sessions, paged by
  a `(uploaded_at, id)` cursor — a cursor rather than an offset, because a page
  boundary that repeats or skips a row is worse than no paging.
- **And that is also the query plan.** The index is
  `(member_id, uploaded_at desc, id desc)`; across a whole Org the id set has
  many Members in it, so the ordering could not come from it and the plan was a
  sort over every artifact the Org had ever stored, on every render. One Member
  by equality is the shape the index answers, asserted by a plan test beside
  the existing one for the Member's own listing.
- **`storedProjects` is bounded too**, at 50 groups with a `more` flag: an Org
  with 500 Members had thousands of `<li>` in one response.
- **`reachesTeamTranscripts` names its Roles** rather than `!== 'member'`.
  This is the gate on the one surface that lists other people's transcripts,
  and a Role added later should have to be let in.
- **A viewer in two Orgs is told which.** `sessclone_visible_member_ids()`
  unions every Org the caller owns or administers _and_ their own memberships
  elsewhere, so a team listing can carry a second Org's rows — the page named
  one Org in its own description and would have shown them all under it. Each
  group now carries its Org, tested with a real second membership.
- **The own listing pays for nothing it does not render**: the `members` and
  `users` joins are added only for a team listing.
- The options object replaced the positional `storedSessions(tx, undefined,
'team')`, and the tautological assertion is gone. New tests: the cursor
  across three pages, a group a Manager may not see coming back empty rather
  than refused, the plan, the Manager reading a Member's address through their
  Scope, and the two-Org case.
