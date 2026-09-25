# 134: Org switcher, pending invitations, and one Org's rows at a time

**What to build:** Taha, 2026-09-25: "Make org switcher and in it a pending invites section too." Someone can belong to several Orgs (`members` is unique on `(org_id, user_id)`), but the dashboard picked one Org with no way to change it. Devices, Keys and Transcripts read through RLS alone, so a person in two Orgs saw both Orgs' rows mixed together. An invitation could only be accepted from its email link, there was no decline, and nobody could leave an Org.

**Where the ask forks, and what was picked (Taha's picks, 2026-09-25).**

1. **Variant A.** The Org name in the header opens the switcher: a popover on desktop, a bottom sheet on a phone. It shows the pending invitation count. Mockups of A and B: https://claude.ai/artifact/LskpcN5Ve5tnhmbBm8CAmq
2. **Decline** hides the invitation from the invitee. The Admin sees "declined" and can invite the same person again.
3. **Expired invitations** show muted for 7 days, with Dismiss, then disappear.
4. **The chosen Org is remembered per device**, in a cookie, and checked against the person's own live memberships on every request.
5. **Leave.** The last Owner cannot leave; they hand ownership over first (a Role change to Owner on Members). Account deletion does not exist and is not part of this ticket.
6. **Invitations match the verified sign-in email**, never `users.email`.
7. **An Org waiting for approval can be switched into**, and it shows the waiting page.
8. **No Personal Org** for someone who signs up through an invitation.

With one Org and no invitations, nothing changes and nothing is clickable. Leave shows only when there is another Org to go to.

**Blocked by:** —

**Status:** done

- [x] Devices, Keys, Transcripts (both sections) and appearance read the current Org or membership, not every membership. Proven by `multi-org.test.ts` running as `sessclone_app`.
- [x] Org settings, Members, invite and key writes refuse a form drawn for another Org (a tab left open across a switch).
- [x] Migration `20260925120000_org_switcher.sql`: `invitations.declined_at`, definer functions to list, accept, decline and leave, the last-Owner race closed with an Org lock, and the one-argument accept kept for the deploy window.
- [x] Switcher UI, variant A, at 1440x900 and 390x844 in light and dark.
- [ ] Playwright flow: accept an invitation from the switcher. Moved to ticket 135.
- [x] Migration run on production before the deploy (Taha, 2026-09-25; deployed with the merge of #42).
- [ ] A later migration drops the one-argument `sessclone_accept_invitation(text)` once the deploy is live. Moved to ticket 135.
