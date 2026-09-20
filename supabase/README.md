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

`apps/web/schema.test.ts` applies every migration to an empty database and
fails if a table arrives without row-level security or without a policy. The
full Role matrix is Seam C, and belongs to ticket 44.

## Applying them locally

```bash
sudo -u postgres psql -c "create role sessclone login password 'sessclone'"
sudo -u postgres createdb sessclone_test --owner sessclone
pnpm test
```

The tests apply the migrations themselves, so there is no separate migrate
step. `DATABASE_URL` overrides the default,
`postgres://sessclone:sessclone@127.0.0.1:5432/sessclone_test`.
