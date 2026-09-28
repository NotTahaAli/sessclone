# 144: Delete an Org that is still waiting for approval

**What to build:** Taha, 2026-09-28: allow people to delete a pending Org.

**What was decided (Taha, 2026-09-28).**

- Only an Org still waiting for approval: `inactive` or no subscription row, as the Admin panel counts waiting. A cancelled Org was approved once and keeps its Turns, so it stays.
- Its Owner deletes it. Other Members cannot. An Owner in their deletion grace cannot.
- Delete is real: the Org row goes, with its memberships, invitations and the plan it asked for. A waiting Org cannot make a key, so it has no Turns; one that somehow has history is refused by the database.
- The button is on the waiting page, behind a first press and the Org's name typed out.
- Deleting your only Org is allowed and lands you on starting one. It also frees the one-waiting-Org limit.
- Platform admins get the same delete on the Admin panel's Org page.

**Blocked by:** none

**Status:** done

- [x] `sessclone_delete_pending_org` and its database tests
- [x] Delete on the waiting page, for the Owner
- [x] Delete on the Admin panel's Org page
- [ ] Taha: run the migration SQL in production before the deploy
