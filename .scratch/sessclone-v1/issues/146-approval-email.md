# 146: Email the Owners when their Org is approved

**What to build:** Sign-up stays hand-approved (Taha, 2026-10-01: the
founding pilot is 10 Personal plans, approved within the hour). Until now the
Owner of a waiting Org was never told it had been approved: the waiting page
said "Reload this page once you hear it is approved", and the only way to hear
was a message sent by hand. Every hour between approval and the Owner coming
back is a sign-up that may not come back at all.

**What was decided (overnight, unattended; Taha may change any of it).**

- The save on the Admin Org page that lets a locked Org in (no row,
  `inactive` or `cancelled` to `active` or `past_due`) emails the Org's
  current Owners: not removed ones, not scrubbed accounts. Re-saving an open
  Org, or moving it between open statuses, sends nothing.
- Only while approval is on (`SIGNUP_APPROVAL`), and only when SMTP is set,
  like the sign-up notice (ticket 120). Sent after the response; a mail
  failure never undoes the approval.
- The email links to Costs, where onboarding (ticket 45) walks them through a
  key and the Collector.
- With SMTP set, the waiting page says the Owners get an email the moment the
  Org is approved, instead of "reload this page".
- No migration: the operator already reads every Org's Members and people.

**Blocked by:** none

**Status:** done

- [x] `setSubscription` reports `approved`, tested across every transition
- [x] `approvalNotice` reads the current Owners as the operator; removed and
      deleted Owners left out, a stranger reads nothing
- [x] `renderApprovalNotice` in the Direction A layout, Org name escaped
- [x] `activateAction` schedules it with `after()`, once, never with approval
      off; each test red with its fix reverted
- [x] Waiting page copy when SMTP is set
