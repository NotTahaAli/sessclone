# 102: A name for an Org that only platform administrators see

**What to build:** Taha, 2026-09-23: "and for admin to assign admin only names to organisations." An operator tells Orgs apart by more than what each calls itself: "Acme (pilot)", "Taha's test Org".

**Where the ask forks, and what was picked (Taha's pick: admin pages).**

- Its own table, `org_operator_names`, with one platform-admin-only policy. A column on `orgs` would be readable by every Member through `orgs_read`, which grants the whole row.
- Shown on the admin Orgs list and an Org's admin page, leading, with the Org's own name beside it. The list filter matches either name. Never shown inside the dashboard.
- A pencil on the Org's admin page. An empty box clears it, and the row is deleted.

**Blocked by:** 48.

**Status:** done

- [x] Migration `20260923100000_org_operator_names.sql` with its policy and grants
- [x] Admin list and Org page lead with it; filter matches it
- [x] An Org's own Owner reads nothing and is refused a write; tested as `sessclone_app`
