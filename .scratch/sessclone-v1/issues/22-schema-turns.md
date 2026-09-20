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
