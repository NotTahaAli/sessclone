# sessclone v1

Status: ready-for-agent
Design: `docs/superpowers/specs/2026-09-12-sessclone-design.md`
Glossary: `CONTEXT.md`

## Problem Statement

A team runs Claude Code in several places at once — laptops, a VPS, Claude Code
Cloud — and nobody can see what any of it costs. Each environment keeps its own
transcripts locally, in a format with token counts but no price, and nothing
aggregates them. A person cannot answer "what did I spend this week", and the
person paying cannot answer it for anyone else, or say which repository or
which machine the spend came from.

The existing tools do not close this. They read one machine's transcripts, and
the two obvious upstream fixes were both declined by their maintainers. Teams
are left with no view at all.

Transcripts also disappear with the machine that made them — and a Claude Code
Cloud container is reclaimed, taking its sessions with it. A team that wants to
study how its own sessions went has nothing to study.

## Solution

sessclone collects Usage from every environment a team works in and shows it in
one dashboard: spend over time for the Org, broken down by Member, Project, and
Device, with an estimated Cost attached to every Turn.

A Member installs a Claude Code plugin once per machine and pastes an API key.
From then on the Collector reports each Turn as it happens, in every
environment, with no further action. A Member who opts in also gets their
session transcripts archived off the machine and downloadable later.

Owners and Admins see the whole Org. A Manager sees the Members assigned to
them. A Member sees only themselves. An Org subscribes to a Tier, billed per
Seat, and a Platform Admin activates it.

Every money figure is an estimate computed from Usage and Rates. Subscription
plans do not bill per token, so sessclone measures awareness, not invoices.

## User Stories

### Collection

1. As a Member, I want to install the Collector as a Claude Code plugin, so
   that I do not have to hand-edit hook configuration on every machine.
2. As a Member, I want to paste one API key into the plugin's configuration, so
   that setup is a single step per machine.
3. As a Member, I want the Collector to be told plainly that plugin hooks only
   take effect after restarting Claude Code, so that I do not think the install
   failed when nothing appears.
4. As a Member, I want the Turns that happened before that restart to be
   collected anyway, so that my first session is not silently missing.
5. As a Member, I want every Turn of my main Session reported as it completes,
   so that the dashboard is current rather than end-of-day.
6. As a Member, I want each Agent Run reported too, so that work I delegate to
   subagents is not invisible spend.
7. As a Member, I want Agent Runs spawned by a workflow collected on the same
   path as any other Agent Run, so that no category of my usage is missed.
8. As a Member, I want collection to work identically on my laptop, my server,
   and Claude Code Cloud, so that I do not maintain three setups.
9. As a Member, I want a Turn reported once even when the Collector sends it
   repeatedly, so that my spend is not inflated by retries.
10. As a Member, I want a failed report retried and then queued, so that a dropped
    network connection does not lose the Turn.
11. As a Member, I want a later Session in the same environment to sweep up
    anything an earlier one failed to deliver, so that gaps heal themselves.
12. As a Member, I want the steady-state report to be small, so that the Collector
    does not consume noticeable bandwidth on a metered connection.
13. As a Member, I want my Devices identified by machine, and every Claude Code
    Cloud container to collapse into one Device, so that my dashboard does not
    fill with containers that existed for an hour.
14. As a Member, I want to give a Device a nickname, so that `host:MBP-2` reads as
    "work laptop".
15. As a Member, I want the same repository on two machines recognised as one
    Project, so that per-Project spend is not split by how each machine cloned it.
16. As a Member, I want work in a directory that is not a repository still
    attributed somewhere sensible, so that it is not dropped.
17. As a Member, I want the Collector to send only counters and identifiers, so
    that my prompts and code never leave the machine unless I ask them to.

### Seeing spend

18. As a Member, I want to see my own spend over a date range, so that I can tell
    whether a heavy week was unusual.
19. As a Member, I want my spend split by Project, so that I know which work is
    expensive.
20. As a Member, I want my spend split by Device, so that I can tell local work
    from cloud work.
21. As an Owner, I want the Org's total spend over time, so that I can see the
    trend at a glance.
22. As an Owner, I want spend per Member, so that I know where the budget goes.
23. As an Owner, I want spend per Project across the whole Org, so that I can
    attribute cost to work rather than to people.
24. As an Owner, I want the dashboard bucketed in the Org's timezone, so that a
    day means the same thing to everyone reading the chart.
25. As a Manager, I want the same views restricted to the Members assigned to me,
    so that I can manage my own team without seeing the rest of the Org.
26. As any viewer, I want token counts shown alongside estimated Cost, so that I
    can sanity-check the money figure.
27. As any viewer, I want Turns whose model has no Rate shown as unpriced rather
    than free, so that a gap in the Rate table cannot masquerade as zero spend.
28. As an Owner, I want history to reprice itself when a missing Rate is added,
    so that a late Rate fixes the past rather than only the future.

### Transcripts

29. As a Member, I want transcript archival off by default, so that nothing
    leaves my machine until I decide it should.
30. As a Member, I want to exclude individual Projects once archival is on, so
    that I can archive work sessions and not personal ones.
31. As a Member, I want to delete transcripts I have already uploaded, so that
    turning archival off is not my only recourse when something sensitive got
    out.
32. As a Member, I want a Session's transcript uploaded once and replaced as it
    grows, so that storage does not fill with partial copies.
33. As a Member, I want an unchanged transcript skipped rather than re-uploaded,
    so that repeated reports cost nothing.
34. As a Member, I want to download a whole Session transcript, so that I can feed
    it to an analysis tool.
35. As an Owner, I want to download any Member's Log Artifacts, so that the Org
    can study its own work.
36. As a Manager, I want to download the Log Artifacts of Members in my Scope
    only, so that my access matches my responsibility.
37. As an Owner, I want to set how long Log Artifacts are kept, so that we are not
    storing transcripts indefinitely.
38. As an Owner, I want Retention to apply only to Log Artifacts, so that turning
    off transcript storage never erases our spend history.

### Accounts and access

39. As a new user, I want to sign in with GitHub, so that I do not create another
    password.
40. As a user whose employer blocks OAuth apps, I want a magic-link sign-in, so
    that I can still get in.
41. As an Owner, I want to create an Org, so that my team has somewhere to live.
42. As an Owner, I want to invite people by email, so that they can join without
    me provisioning anything.
43. As an invited person, I want to accept an invitation and land in the Org, so
    that setup ends where I need to be.
44. As an Owner, I want to assign Roles, so that authority matches responsibility.
45. As an Admin, I want to assign Members to a Manager's Scope, so that a team
    lead sees their own team.
46. As a Manager, I want my Scope to be visible to me, so that I know what I can
    and cannot see.
47. As a Member, I want other Members unable to see my usage, so that a shared
    dashboard is not a performance ranking.
48. As an Owner, I want to remove a Member, so that someone who leaves stops
    consuming a Seat.
49. As an Owner, I want a removed Member's historical Turns kept, so that past
    spend still reconciles.

### Keys

50. As a Member, I want to create an API key and see it once, so that it is not
    sitting in the dashboard to be shoulder-surfed later.
51. As a Member, I want to label each key, so that I know which machine it is on.
52. As a Member, I want to see when a key was last used, so that I can spot a key
    I have forgotten.
53. As a Member, I want to hold several keys at once, so that I can rotate one
    machine without breaking the others.
54. As a Member, I want to revoke a single key, so that a lost laptop does not
    cost me every other machine.

### Billing

55. As an Owner, I want to see the Tier my Org is on and what it includes, so that
    I know what I am paying for.
56. As an Owner, I want Seats counted from Members only, so that a read-only
    Manager does not cost me a Seat.
57. As an Owner, I want to be stopped from exceeding my Tier's Seat limit, so that
    I am not billed by surprise.
58. As an Owner, I want to know when transcript archival is unavailable on my
    Tier, so that the feature's absence is explained rather than broken.
59. As a Platform Admin, I want to activate an Org's subscription by hand, so that
    a team can start before a payment rail exists.
60. As a Platform Admin, I want every activation recorded, so that the history is
    auditable when a real provider is attached later.
61. As a Platform Admin, I want to edit Tiers and their included capabilities, so
    that pricing changes without a deployment.
62. As a Platform Admin, I want to maintain the Rate table with effective dates,
    so that old Turns keep the price that was current when they ran.
63. As a Platform Admin, I want to see model ids that appeared with no Rate, so
    that I can fill the gap.
64. As an Owner with negotiated pricing, I want Org-level Rate overrides, so that
    estimates match what my Org actually pays.

### Self-hosting

65. As a self-hoster, I want every external dependency configured by environment
    variable, so that I can point the app at my own Postgres and my own bucket.
66. As a self-hoster, I want the plugin to target my deployment, so that my team's
    Turns go to my server.
67. As a self-hoster, I want the same marketplace install path, so that I am not
    maintaining a separate distribution.

## Implementation Decisions

### Packages

- `packages/shared` — the wire contract and all pure logic: the zod schema for
  a reported Turn, transcript parsing, identity normalisation, and Cost
  computation. Imported by both the Collector and the web app, so a change to
  the payload breaks the build rather than production.
- `packages/plugin` — the Claude Code plugin: hook entry points, cursor and
  queue handling, HTTP transport. Logic beyond orchestration belongs in
  `shared`.
- `apps/web` — Next.js, serving both the dashboard and the ingest routes.
- `supabase/migrations` — schema, RLS policies, seed Rates.

### Transcript parsing

- A Turn is produced from an entry carrying `message.usage`. The parser keys on
  that presence rather than on a list of entry types to skip: bookkeeping types
  are open-ended, and four already exist with no `uuid` and no `timestamp`.
- Entries repeat per content block, sharing one `message.id` with identical
  Usage. The parser emits one Turn per `message.id`, taking the entry with
  `apiBlockIndex` 0. Summing without this overcounts by roughly 2.4x.
- `usage.iterations[]` is ignored; the top-level counters are authoritative.
- Cache-creation tokens are split into 1-hour and 5-minute columns, never
  summed.
- `service_tier`, `speed`, `inference_geo`, `model`, and the Claude Code version
  are carried onto the Turn, because each changes the price or explains it.
- An Agent Run's Turns are parsed from the agent transcript the `SubagentStop`
  event names, which is a different field from that event's `transcript_path`.
- A Session's transcripts are located by searching every project directory for
  the Session's id: the transcript directory derives from the working directory
  and does not follow a Session whose working directory changes.
- Workflow Agent Runs sit one directory level deeper than other Agent Runs, so
  the search recurses.

### Identity

- Turn identity is `(member_id, session_id, agent_id, message_id)`, with
  `agent_id` null for a main Session. A unique index enforces it and ingest
  writes `ON CONFLICT DO NOTHING`.
- Device key is `host:<hostname>` locally and
  `cloud:<account uuid>` in Claude Code Cloud, suffixed with the environment
  type when it is not the default. Keyed per Member, never globally.
- Project key normalises a git remote to lowercase `host/owner/repo`, stripping
  credentials and the `.git` suffix; a non-repository directory keys as
  `local:<hostname>:<absolute path>`.
- The Collector stores each Agent Run's reported spawn depth rather than
  assuming one level.

### Collector

- Hooks: `Stop`, `SubagentStop`, `SessionStart`, `SessionEnd`, `StopFailure`.
  Registered through a `hooks` pointer in the plugin manifest, which is what
  makes Claude Code load them.
- A per-Session cursor file records the last acknowledged `message.id` and byte
  offset. The transcript is append-only, so the offset is stable.
- The cursor is an optimisation, never correctness: a lost cursor costs
  bandwidth because the unique index absorbs the repeats.
- A failed report retries three times with increasing delay, then appends to an
  on-disk queue drained by the next `SessionStart` in that environment.
- `SessionStart` also re-reports everything for Sessions not known to be
  complete, which is what backfills the Turns from before a plugin install took
  effect.
- The Collector never computes Cost and never sends prompt or code content.

### Ingest

- `POST /api/ingest` verifies the API key by hash, resolves the Member, upserts
  Turns, and returns the last accepted `message.id` for the cursor.
- `POST /api/logs/presign` refuses to issue a URL when the submitted transcript
  hash matches what is stored, and refuses outright when the Member has not
  opted in, when the Member has excluded that Session's Project, when the Tier
  excludes archival, or when the Session has no ingested Turns to resolve a
  Project from — each with a distinguishable reason. The Project the request
  carries is advisory; the route resolves it server-side.
- Uploads go straight to storage with a presigned PUT; the application never
  carries transcript bytes.
- Both routes validate their input with the shared zod schema before touching
  the database.

### Data

- `turns` is append-only, never subject to Retention, and stores Usage exactly
  as reported plus a nullable Reported Cost that v1 never populates.
- Cost is computed at read time from Rates and the Turn's modifiers, not stored,
  so adding a Rate reprices history.
- A Rate row is `(model, token_class, price_per_mtok, effective_from)` across
  five token classes; Org overrides live in a parallel table.
- Modifiers multiply the resolved rate: fast mode, US-only inference, batch
  tier. Server-tool requests are priced per request, with web fetch stored at a
  zero rate so the Rate table remains the only place a price lives.
- An unpriced model yields a null Cost, never zero, and the model id is surfaced
  to the Platform Admin.
- Roles are Owner, Admin, Manager, Member; `member_scopes` maps a Manager to the
  Members they may see; `is_platform_admin` is a flag on the user, outside any
  Org.
- Subscriptions carry `provider` (`manual` in v1) and nullable provider
  identifier columns, and every activation writes a subscription event, so a
  real payment rail attaches later without a migration.
- Tiers gate Seats, whether archival is available, and the Retention ceiling,
  with further capabilities in a JSON column.

### Dashboard

- Charts query `turns` directly against `(org_id, occurred_at)` and
  `(member_id, occurred_at)` indexes. No rollup tables; the invalidation problem
  a backfill would create is not worth the speed at this size.
- Timestamps are stored in UTC and bucketed at query time in the Org's timezone.
- Reads go through RLS as the signed-in user, so the Role rules are enforced in
  one place for both the browser and the server.

## Testing Decisions

A good test here fixes external behaviour and nothing else: the Turns a
transcript yields, the Cost a Turn and a Rate table produce, the rows an ingest
request leaves behind, what a given Role can read. Tests that assert on
internal structure — how the parser loops, which helper the route calls — are
churn, and none are wanted.

There is no prior art in this repository: it is empty, and these are the first
tests. They set the pattern.

**Seam A — `packages/shared` public API.** Pure functions, no database and no
network. Fixtures are real captured transcripts, including the multi-block
entries that caused the 2.4x overcount, the four bookkeeping entry types with
no `uuid`, a workflow Agent Run transcript, and an Agent Run transcript
carrying its parent's Session id. Covers: one Turn per `message.id`; entries
without Usage ignored; cache-creation split preserved; Device and Project keys
normalised, including the two spellings of one git remote; Cost correct for each
token class; each modifier applied; a model absent from the Rate table yielding
null rather than zero; a Rate added later changing the computed Cost of an old
Turn.

**Seam B — HTTP routes.** Exercised by calling the route handlers against a
real Postgres with the real migrations applied. Covers: a valid report stored;
the identical report sent twice leaving one row; a revoked or unknown key
rejected; a malformed payload rejected before any write; a presign request
refused when the hash is unchanged, when the Member's master switch is off,
when the Project is excluded, when the Tier excludes archival, and when the
Session has no ingested Turns to resolve a Project from; the response carrying the cursor position the
Collector needs.

**Seam C — RLS policies, as SQL.** Run against a seeded database as each Role,
because the rules live in Postgres and testing them through the app would test
the wrong layer. Covers: a Member reading only their own Turns; a Manager
reading exactly their Scope and nothing outside it; a Manager with an empty
Scope reading nothing; Admin and Owner reading the whole Org; no Role reading
another Org at all; Log Artifact access following the same shape; a Member
unable to alter their own Role.

**Seam D — the Collector, with time and transport faked.** The hook shell is
thin, but the failure behaviour is not, and it is the part that loses data when
wrong. A fake clock and a fake transport cover: a steady-state report sending
only Turns past the cursor; three retries at increasing delays before the queue
is touched; a queued report drained by the next sweep; a deleted or corrupt
cursor causing re-reporting rather than loss; a sweep re-reporting an incomplete
Session in full; nothing sent when the transcript has not grown.

Wiring the hooks themselves is verified by hand on a real install, once per
supported environment. Automating that would mean automating Claude Code.

## Out of Scope

- Automated payment collection. v1 models and enforces subscriptions; a
  Platform Admin activates them by hand.
- A transcript viewer in the browser. Log Artifacts download; they do not
  browse.
- Analytics over `StopFailure` rows. The rows are collected in v1; the charts
  are not built.
- Rate-limit forecasting, quota prediction, or anything resembling a budget
  alarm.
- Per-tool, per-prompt, or per-file attribution of spend.
- SSO, SCIM, audit-log export, and every other enterprise control.
- Importing history from other Claude Code usage tools.
- A public API. The ingest routes serve the Collector, not third parties.

## Further Notes

The business framing is unvalidated. Four open-source attempts at multi-machine
Claude Code usage aggregation exist and none reached adoption, and both obvious
upstream maintainers declined this scope. The team-and-Seats shape is the answer
to that, not evidence against it; the risk stands.

Log Artifacts are the largest liability in the product. Transcripts contain
source code and can contain credentials. Archival stays opt-in per Member, off
by default, excludable per Project, and an Admin cannot enable it on someone's
behalf.

Rate accuracy is manual. A missed price change makes every estimate quietly
wrong until someone notices, which is the strongest argument for showing token
counts beside every Cost.

Several behaviours remain unverified and should be settled during
implementation rather than assumed: whether a resumed or forked Session appends
to the same transcript or opens a new one; whether a forcibly reclaimed
container fires `SessionEnd` at all; what a compaction leaves in the transcript;
how a mid-session model switch appears; and the entire local-machine path on
macOS and Windows, which no session so far has touched. Every transcript finding
to date comes from one Claude Code Cloud session on one model.
