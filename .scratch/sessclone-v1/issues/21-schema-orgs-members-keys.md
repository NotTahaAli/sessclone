# 21: Schema — orgs, users, members, API keys, scopes

**What to build:** The account tables and their policies, so an Org, its Members, their Roles, a Manager's Scope, and their API keys all have somewhere to live.

**Blocked by:** 01, 11, 14.

**Status:** done

- [x] Tables for orgs, users, members, api_keys, and member_scopes
- [x] Role recorded per member; platform administration flagged on the user, outside any Org
- [x] API keys store a hash and a short display prefix, never the key
- [x] Members carry the archival master switch, off by default, writable only by that Member
- [x] Policies ship in the same migration as the tables
- [x] Migration applies and rolls forward cleanly from empty

**Answer:** `supabase/migrations/20260920120000_accounts.sql` creates `orgs`,
`users`, `members`, `api_keys` and `member_scopes`, with their policies in the
same file — ADR 0001's rule, because a migration that defers policies has
shipped a table readable by everyone in the window between the two.

Five helper functions answer the questions every policy asks, once:
`sessclone_user_id()`, `sessclone_is_platform_admin()`, `sessclone_org_ids()`,
`sessclone_admin_org_ids()`, `sessclone_own_member_ids()` and
`sessclone_visible_member_ids()`. They are `security definer` so a policy on
one table may consult another without that table's policy recursing back, and
`stable` so a policy can wrap the call in `(select …)` and have Postgres run it
once per statement rather than once per row — the pattern Supabase's own RLS
performance guidance names, confirmed against their docs through Context7
rather than recalled.

**These migrations apply to a plain Postgres.** Nothing references the `auth`
schema and no policy names `authenticated` or `service_role`, because neither
role exists outside Supabase. `sessclone_user_id()` reads
`request.jwt.claim.sub`, falling back to the `sub` claim of
`request.jwt.claims` — which is what `auth.uid()` itself reads. CI runs a bare
`postgres:16.15` container, and a self-hoster gets the same enforcement from
the same files.

**Two things RLS cannot express, so they are triggers.** A policy grants or
refuses a whole row, and two columns here need finer control than that. A
Member may write their own archival switch and nothing else; an Owner or Admin
may write a Role but never somebody else's archival switch — ADR 0005 is
explicit that this is the one place an Admin is not a superset of a Member. And
`is_platform_admin` may only be changed by somebody who already has it, or the
flag is self-service.

**Removal is `removed_at`, not a delete.** A removed Member stops consuming a
Seat and stops seeing anything, but their historical Turns still have to
reconcile, so the row stays and `turns` keeps its foreign key. `members` also
carries a second unique key on `(org_id, id)`, which looks redundant beside the
primary key and is not: it is what lets `member_scopes` name an Org and a
Member in one foreign key, so a Manager cannot be scoped to somebody in a
different Org.

**Not done here, and named so nobody assumes it:** the full Role matrix is Seam
C and belongs to ticket 44. `apps/web/schema.test.ts` carries a smoke test —
enough to prove the policies are enforced from a non-owner role at all, rather
than sitting inert — and no more. A plain-Postgres deployment will also need
`grant` statements for whichever role the app connects as; Supabase issues
those itself, and ticket 67 is where self-hosting proves it.

## Comments

A fresh-eyes review ran these migrations against a live Postgres as a
non-superuser role and landed a working cross-Org privilege escalation. It is
closed, along with three more, and each one now has a test that fails without
its fix.

**A Member could join any Org whose id they knew.** `members_write` let a
Member update their own row, `user_id = me` satisfied both the USING and the
WITH CHECK clause, and nothing pinned `org_id` — so rewriting it moved the row
into somebody else's Org and handed over `orgs_read` and `projects_read` with
it. The sharper version was an Admin grafting a victim's row, and every Turn
hanging off it, into a second Org under their own user id: an identity
takeover that also rewrites story 49's history. Both are now refused by the
guard trigger, which pins `org_id` and `user_id` for the life of a row.

**An Admin could switch on somebody else's archival at invite time.** The
trigger was `before update` only, so the column ADR 0005 reserves to the Member
was free on insert. It is `before insert or update` now.

**A revoked API key could be un-revoked** by clearing `revoked_at`, which is
the one thing a Member's own key management must not allow — a lost laptop is
why the column exists.

**Org creation was a dead end.** `orgs_create` let any signed-in user insert an
Org, and nothing let them become its first Member, so story 41 could only be
served by the service role — which ADR 0001 confines to ingest. There is now a
narrow bootstrap branch on `members_invite`: your own user id, the Owner role,
and only while the Org has no Members at all. A test confirms it cannot be used
to walk into an Org that already has any.

**One thing the review found that is a cost rather than a bug**, and it is
worth knowing before writing ticket 49: `insert … returning` applies the SELECT
policy to the new row, and a `stable` helper is evaluated against the
statement's snapshot, in which that row does not exist. `members_read` now
carries a second branch that asks about the new row's own `org_id` instead,
which needs nothing from the snapshot, so an Admin's invite gets its id back in
one round trip. The bootstrap insert still cannot use RETURNING, because the
caller is not yet a Member of anything — a client-generated uuid is the way
round it.

Deliberately not changed: `members_read` has no "my own user id" branch. It
would show a removed Member their own row, and `members_write` would then let
them clear their own `removed_at`.
