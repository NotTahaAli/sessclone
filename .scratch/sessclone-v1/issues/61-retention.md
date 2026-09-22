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
