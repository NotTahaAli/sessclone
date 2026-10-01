# 149: Self-hosting in one command and one button

**What to build:** Overnight (2026-10-01). Self-hosting is the free way in,
and its guide was a dozen hand-run steps: create two roles, a `psql` loop over
the migrations, an `alter role`, and a trigger dance for the first platform
admin. A hand-applied database also had no migration ledger, so
`schema-drift.mjs` could not say what an upgrade was missing.

**What was decided (overnight, unattended; Taha may change any of it).**

- `apps/web/scripts/setup-db.mjs`, run with the app's own two database URLs:
  applies the migrations it has not had (one transaction each), records them
  in `supabase_migrations.schema_migrations`, gives `sessclone_app` its login
  from `DATABASE_URL`'s password, and refuses unless `DATABASE_URL` reads as
  the role row-level security applies to. Re-running is a no-op.
- An upgrade stops before a migration whose header says RUN THIS AFTER THE
  DEPLOY; `--after-deploy` runs it. A fresh database runs everything.
- `--admin <email>` makes the first platform admin.
- A database migrated by the old loop (tables, no ledger) is refused rather
  than re-migrated.
- Docs and README open with a Vercel + Supabase quick start and a Deploy to
  Vercel button (root `apps/web`, the five required variables).

**Blocked by:** none

**Status:** done

- [x] Unit tests for what is applied and which role is accepted (red when the
      after-deploy hold is removed)
- [x] Run against a local Postgres: fresh, interrupted, re-run, upgrade hold,
      `--after-deploy`, wrong role, password rotation, `--admin`
- [x] Docs page screenshots at 390 and 1440, light and dark
