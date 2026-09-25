# 136: New Org in the Org switcher

**What to build:** Taha, 2026-09-25: a person can start another Org from the Org switcher, the same way sign-up starts their first one.

**What was picked (Taha's picks, 2026-09-25).**

1. **A "New Org" row** at the bottom of the Org switcher. The switcher always opens now, even with one Org and no invitations. Leave still shows only when there is another Org to go to.
2. **A plan**, asked for exactly as sign-up's plan step asks (the same radios and Team size, the same parsing). Wherever sign-up skips the plan step (`SIGNUP_APPROVAL=off`), this skips it too.
3. **Approval**, as a sign-up: the new Org waits for a Platform Admin with an `inactive` subscription row on the plan asked for. With approval off it opens at once, as a sign-up does.
4. **Limits.** Any number of approved Orgs. At most one Org the person owns that is waiting for approval (`inactive` or no subscription row); cancelled Orgs do not count. Enforced on the server and race-safe: two submits at once create one Org. The form says why it refused. The switcher's Orgs and invitations lists scroll when long, on the phone sheet and the desktop panel.
5. **A name**, trimmed, 1 to 60 characters: the rule Org settings already applies to a rename.
6. **Lands in the new Org:** the switcher's cookie is set to the new membership, so the person sees it at once (the waiting page while it waits).

**Blocked by:** 134

**Status:** todo

- [ ] `createOwnOrg` in `lib/auth/bootstrap.ts`, sharing the Org-making statements with sign-in; a per-person advisory lock and the waiting-Org check. No migration. Proven by `new-org.test.ts` on two real connections.
- [ ] `/new-org`, outside the dashboard shell so it is reachable while the current Org waits; the switcher on the waiting page, so a person can switch out of a waiting Org.
- [ ] Switcher and form at 1440x900 and 390x844 in light and dark.
- [ ] Playwright flow: create an Org from the switcher and land on the waiting page.
