# supabase

Migrations, RLS policies, and local stack config.

Every migration is plain SQL, applied in filename order. They run against a
plain Postgres as well as a Supabase project: nothing references the `auth`
schema, and `sessclone_user_id()` reads the same JWT claim settings that
Supabase's own `auth.uid()` reads, so CI, a self-hoster's cluster and the
hosted deployment all get the same rules.

| Migration                       | What it creates                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `20260912000000_probe_rows.sql` | Ticket 02's throwaway table. Expected to be deleted, not migrated               |
| `20260920120000_accounts.sql`   | `orgs`, `users`, `members`, `api_keys`, `member_scopes`, and the policy helpers |
| `20260920120100_collection.sql` | `devices`, `projects`, `turns`, `session_events`, archival exceptions           |

**A table ships with its policies in the same migration** (ADR 0001). A
migration that creates a table and leaves its policies to a later one has
shipped a table readable by everyone in the window between the two.

**The role matters as much as the policy.** Postgres applies no policy to a
superuser and none to a table's owner, and `sessclone` owns every table here
because it applies the migrations. So the dashboard reads as `sessclone_app`
instead — granted select, and the few write verbs a policy governs, and
nothing else. The owner keeps its exemption on purpose: that is what ingest
writes a Turn with, on a plain Postgres as `service_role` is on Supabase, and
it is why `turns` needs no insert policy.

`apps/web/test/harness.ts` applies every migration to an empty database once
per test run and empties it between tests; `test/schema.test.ts` fails if a
table arrives without row-level security or without a policy. The full Role
matrix is Seam C, and belongs to ticket 44.

## Applying them locally

```bash
sudo -u postgres psql -c "create role sessclone login superuser password 'sessclone'"
sudo -u postgres psql -c "create role sessclone_app login password 'sessclone_app'"
sudo -u postgres createdb sessclone_test --owner sessclone
pnpm test
```

The tests apply the migrations themselves, so there is no separate migrate
step. `DATABASE_URL` overrides the owner's default,
`postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test`, and
`APP_DATABASE_URL` the dashboard's,
`postgres://sessclone_app:sessclone_app@127.0.0.1:5432/sessclone_test`.

`superuser` on `sessclone` is not a recommendation about deployments — it is
what `POSTGRES_USER` already gets from the CI container, spelled out so a
cluster built by hand behaves the same. `schema.test.ts` creates an
unprivileged probe role and switches into it, and nothing short of a superuser
can do both: a plain role fails with `permission denied to create role`, and a
`createrole` role gets a membership without the `set` option and fails with
`permission denied to set role`. The privilege that matters to production is
the one `sessclone_app` does _not_ have.

The migration creates `sessclone_app` itself if it is missing, but without a
password — a migration has no business inventing a credential. Creating it
first, as above, is what gives it one, and is also what lets a deployment apply
migrations with no `createrole` at all. A deployment that would rather not have
a second password can create it as a group and grant it to a login role it
already has.
