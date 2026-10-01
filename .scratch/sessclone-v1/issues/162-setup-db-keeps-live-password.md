# 162: setup-db never replaces a live sessclone_app password

**What to build:** coordinator, 2026-10-01, overnight review of PRs #64-#74.
`apps/web/scripts/setup-db.mjs` (#68) gave `sessclone_app` the password in
`DATABASE_URL` whenever that URL's login was refused. A wrong password is a
refused login too, and the role is cluster-wide: a typo, a stale `.env`, or a
staging database on the production cluster replaced the live password and took
the dashboard down. Reproduced by the reviewer: second run with a wrong
password printed "gave sessclone_app its login" and the real password then
failed with `28P01`.

**What was decided.**

- The password is set only when `sessclone_app` cannot log in yet (the first
  run, after the migration creates it `nologin`). A refused login from a role
  that already has one stops the run and names the `alter role` to run on
  purpose.
- `test/setup-db.test.ts` runs the script with a wrong password and checks the
  real one still logs in; red without the fix.
- `docs/self-hosting.md` and the docs page say the script stops on a mismatch.

**Status:** done

- [x] Refuse a wrong password for a role that already logs in, test red
      without the fix
