# 135: Org switcher follow-ups

**What to build:** What ticket 134 left open once #42 was deployed on 2026-09-25.

1. **Drop the one-argument accept.** `20260925120000_org_switcher.sql` kept `sessclone_accept_invitation(text)` so invitation links kept working between the SQL run and the deploy. The deployed app calls the two-argument form, so the one-argument form is now dead code with execute granted to `sessclone_app`. A new migration drops it. It runs on production like any other, by Taha in the SQL editor, with its `supabase_migrations.schema_migrations` row.
2. **Playwright flow.** Accept an invitation from the switcher, then land in the new Org. This is the "invite someone into a full Org" family of flows `AGENTS.md` names as worth a browser test.

**Blocked by:** 134

**Status:** todo

- [ ] Migration drops `sessclone_accept_invitation(text)`; `invitations.test.ts` no longer exercises the one-argument form.
- [ ] Migration run on production (Taha).
- [ ] Playwright: accept an invitation from the switcher.
