# 61: Retention

**What to build:** Transcripts stop accumulating forever: an Org sets how long they are kept, within what its Tier allows, and older ones are removed.

**Blocked by:** 47, 51, 59.

**Status:** done

- [x] Retention set by an Owner or Admin, defaulted, and capped by the Tier ceiling
- [x] Artifacts past the window removed from storage and from the record
- [x] Turns are never touched by retention, so spend history survives
- [x] Removal is idempotent and safe to re-run

## What landed

- `supabase/migrations/20260922100000_org_retention.sql` — `orgs.retention_days`,
  defaulted to 90 rather than to forever, because "keep everything" is not a
  decision anybody made. Who may set it is `orgs_write`, which is Owner or
  Admin (ticket 21), so the column needed no new policy. What may is a
  `before insert or update` trigger that raises when the window is past the
  Tier's `retention_max_days`, with `search_path` pinned to `public, pg_temp`
  — a `security definer` function that omits the pin reads a forged `tiers` out
  of the caller's temp schema.
- `apps/web/lib/retention.ts` — the sweep. Rows and objects go together inside
  one transaction, rows first and the bucket next, so a storage failure rolls
  the rows back rather than leaving a transcript nobody can find and nobody
  can delete. Bounded at 500 per call and drained oldest first, and the
  effective window is `least(the Org's setting, the Tier's ceiling)` so a Tier
  that shrinks after an Org chose cannot be outrun. An Org with no active
  subscription keeps its own window: no Tier is no ceiling here, not a ceiling
  of zero.
- `POST /api/retention/sweep` — secret-gated, constant-time, and refusing
  every call when `RETENTION_SWEEP_SECRET` is unset, because this endpoint
  destroys transcripts. It runs as the owning role: retention crosses every
  Org while `log_artifacts_delete` is deliberately the Member's own rows alone
  (ADR 0005), so there is no viewer it could run as. Answers
  `{removed, remaining}`, and `remaining` is what makes draining a backlog a
  loop rather than a guess.
- The Org-settings control (`settings/org/retention-form.tsx`), stating both
  the window and the Tier's ceiling, and saying that anything already past the
  window goes at the next sweep rather than immediately.
- `apps/web/test/retention.test.ts`, against real Postgres: the default, the
  Owner/Admin-only write as the unprivileged role, the ceiling refused by the
  trigger, a forged `tiers` in `pg_temp` refused, the sweep removing rows and
  objects together, each Org's own window, a shrunk ceiling winning, the
  bound and `more`, idempotence, a refusing bucket keeping every row, Turns
  untouched, and the route's secret, storage gate and answers. Verified red by
  removing the ceiling from the sweep, reversing the drain order, swallowing a
  storage failure, defaulting the secret to open, dropping the storage gate,
  and unpinning `pg_temp`.

**Turns are never touched.** The spend history outlives every transcript it
describes, which is the one thing retention must not take.

Shots: `/tmp/claude-0/shots-61/` — desktop and phone, light and dark, before
and after a save.

## Acted on after review

- **The window is measured from when a transcript was first stored.**
  `uploaded_at` moves every time the confirm route replaces a growing
  Session's object, so a window measured from it was days since the last
  upload and a busy Session could outlive any window. `log_artifacts` gained
  `created_at`, written once and left alone by the upsert, plus an index on
  `(org_id, created_at)` for the sweep.
- **An object nothing names is deleted by the sweep.** The confirm route
  swallowed a failed delete of the object a Session left behind when its
  Project changed — and by then the row had moved to the new key, so nothing
  could ever reach those bytes again. The key is recorded in
  `storage_orphans` and the sweep clears it in the same batch it already
  sends. `.catch(() => {})` on a transcript is source code and sometimes a
  credential kept forever.
- **One sweep at a time**, through `pg_try_advisory_xact_lock`. Two
  overlapping sweeps could not delete an object twice, but the second chose
  rows from a snapshot that still showed the first's, deleted fewer than it
  selected and read that as an empty backlog — stopping a drain with
  thousands left. A sweep that cannot take the lock answers `{removed: 0,
more: true}`.
- **Whether retention runs at all is now visible.** Retention needs a
  scheduler the deployment supplies, so Org settings stated a guarantee
  nothing might be providing. `retention_sweeps` holds one row and the page
  says when retention last ran, or that it never has on this deployment.
- **The window in force is what the page shows.** After a Tier shrinks under
  an Org, the stored setting and the swept window part company — the trigger
  cannot reach a stored value retroactively. The page states both and the
  field is pre-filled with the effective one, which also fixes a form that a
  browser refused to submit because its `defaultValue` was above its own
  `max`.
- **A failure that is not a refusal is not reported as one.** Both Org
  settings actions caught everything and answered with a sentence about the
  setting, so a dead connection read as "your Tier does not allow that".
  Narrowed to the codes a trigger raises; anything else is rethrown.
- Tests: the re-upload anchor, the orphan (swept, and kept when the bucket
  refuses), the lock, the sweep record, and a new `retention-action.test.ts`
  covering the trust boundary, the Owner/Admin-only write through the action
  as the unprivileged role, another Org's id in the hidden field, signed out,
  the ceiling, and a database failure that must not be reported as a Tier
  limit. `schema.test.ts` now asserts that **every** `security definer`
  function in `public` pins `pg_temp`, which is the class of bug
  `20260920120600_search_path.sql` had to repair once.
- Also: the secret handling is one `lib/bearer.ts` rather than a copy per
  route, the sweep no longer returns raw Postgres or S3 error text to its
  caller, the result of a save is announced to a screen reader, and
  `docs/configuration.md` warns that upgrading an existing deployment sets
  every Org to 90 days — with the statement to run before the first sweep.

**Correcting the measurement in the first commit**, which claimed the delete
was index-backed without checking a plan. It is, once the table is analysed
and `(org_id, created_at)` exists: the planner drives a nested loop from
`orgs` and the per-Org cutoff becomes the index condition. Measured on one box
at 200k artifacts across 50 Orgs — 0.5ms with nothing expired, 65ms with 120k
expired. A per-Org `cross join lateral` was written, measured at 220ms on the
same backlog, and dropped.
