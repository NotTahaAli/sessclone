# 22: Schema — turns, devices, projects, session events

**What to build:** The collection tables, including the unique index that makes ingest idempotent.

**Blocked by:** 01, 09, 11, 14.

**Status:** done

- [x] Turn identity enforced by a unique index, per the identity ADR
- [x] Usage stored exactly as reported, with cache creation split into its two classes
- [x] Dimensions carried: model, service tier, speed, inference geography, client version, spawn depth, and the cloud session handle, nullable
- [x] A nullable reported-cost column that nothing populates yet
- [x] Indexes supporting org-and-time and member-and-time reads
- [x] Devices keyed per Member with an editable nickname; projects keyed by normalised remote with the raw remote retained
- [x] A per-Member, per-Project archival exception row, writable only by that Member, with its policies in the same migration
- [x] Policies ship in the same migration

**Answer:** `supabase/migrations/20260920120100_collection.sql` creates
`devices`, `projects`, `turns`, `session_events` and
`member_project_archival`, with their policies in the same file.

**The identity index is `nulls not distinct`.** ADR 0006's key is
`(member_id, session_id, agent_id, message_id)` with `agent_id` null for a main
Session — and a plain unique index treats two nulls as different, so it would
have deduplicated Agent Runs and nothing else. Every Turn a person starts has a
null `agent_id`, so without that clause the index would have missed the case it
exists for. Proved rather than asserted: `apps/web/schema.test.ts` inserts the
same main-Session Turn twice with `on conflict do nothing` and counts one row.

**`turns` has no insert, update or delete policy, deliberately.** It is
append-only and ingest writes it with the service role, which bypasses policies
(ADR 0001 confines that key to paths that have already verified an API key by
hash). A re-report must never rewrite stored Usage, and nothing the browser can
reach may write a Turn at all. The test asserts the refusal rather than
trusting the absence.

**Usage is stored as reported, and no money.** Cache creation keeps its
five-minute and one-hour classes in their own columns with the reported total
beside them — kept rather than derived, so a capture that reports a total with
no split reads as an unexplained total instead of as zero cache creation.
`reported_cost_usd` is nullable and nothing populates it, per ADR 0002: Cost is
computed at read time from Rates, so adding a Rate reprices history and an
unpriced model yields null rather than zero.

**Reads resolve through one function.** Every select policy here is
`member_id in (select sessclone_visible_member_ids())`, so Owner, Admin,
Manager-with-a-Scope and Member are decided once in the accounts migration
rather than restated per table. `member_project_archival` is the exception, and
is the Member's own in both directions: ADR 0005 keeps archival inside the
Member's decision, so an Admin can neither read nor write another Member's
exclusions.

**Indexes:** `(org_id, occurred_at)` and `(member_id, occurred_at)` are the two
reads the dashboard makes, plus project and device variants for the
per-dimension breakdowns. No rollup tables — the spec's call, and the
invalidation a backfill would create is not worth the speed at this size.

**Left in place on purpose:** `supabase/migrations/20260912000000_probe_rows.sql`
says this ticket is where it gets deleted. It is still here, because deleting
it also deletes `apps/web/app/api/probe/` and its tests, which is ticket 33's
call rather than a schema ticket's. The schema test names `probe_rows` as the
one table allowed to have no row-level security, so the exception is visible
rather than silent.

## Comments

The same fresh-eyes review found four defects here, each reproduced as SQL
against a live Postgres and each now covered by a test.

**`projects_read` was Org-wide, and a Project key can be a home directory.**
`local:<hostname>:<absolute path>` is ADR 0005's key for a directory with no
git remote, and every Member of an Org could read every one of them — the
Owner's machine name and folder layout included — as could a Manager with an
empty Scope, which the spec says reads nothing. It now resolves the same way
every other read in this migration does: an Owner or Admin sees their Org's
Projects, and everyone else sees the Projects they have Turns in.

**A Member could re-point or backdate their own Device.** The criterion is an
editable _nickname_; a policy grants a whole row, and the comment claiming
otherwise was the only thing enforcing it. `devices.key` is what the
per-Device breakdown groups on, so rewriting it orphans a Member's own
attribution. A trigger now freezes everything but the nickname.

**`agent_id` had no non-empty check.** The identity index is `nulls not
distinct`, which collapses two nulls — but `''` and `'  '` are ordinary
distinct values, so any path that spelled a main Session's absent agent id as
an empty string would store the same Turn twice. That is the overcount the
index exists to prevent, re-entering through the column it is built on. Checked
on `turns` and `session_events` both.

**Deleting an Org erased its spend history.** `turns.org_id` cascaded while
`turns.member_id` restricted, so whether history survived depended on whether
the Org happened to own a `devices` row. Both are `restrict` now: removal is
`members.removed_at`, and an Org that genuinely has to go deals with its Turns
explicitly.

**A Turn could also be filed under an Org its Member does not belong to** —
invisible to everyone, because reads resolve by Member and every chart filters
by Org. `turns`, `session_events` and `member_project_archival` now carry
`(org_id, member_id)` foreign keys against the composite key ticket 21 put on
`members` for exactly this.

**Left as it is, with reasons:**

- A Platform Admin reads no Turns, Projects or Devices. ADR 0001 grants the
  flag platform-wide access to Rates, Tiers and subscription activation, and
  names nothing else; the operator of a deployment reading every Org's usage is
  a decision that wants making on purpose, not as a side effect of consistency.
  Story 63 needs unpriced model ids, not Turns, and ticket 43 is where that
  read gets its own narrow path.
- The comments asserting `5m + 1h ≤` the reported total, and thinking tokens as
  a subset of output tokens, are still only comments. They are parser
  invariants, and `packages/shared/src/turns.test.ts` holds them; a check
  constraint here would reject a real capture rather than catch a bug.
- `device_id` and `project_id` stay `on delete set null`. Nothing can delete
  either through a policy, and a Turn that loses a dimension is better than a
  Turn that vanishes with it.
