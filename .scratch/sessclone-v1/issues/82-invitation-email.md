# 82: Send the invitation by email

**What to build:** Ticket 49 builds the invitation itself — the token, the acceptance, the seat check — and hands the inviter a link to pass on, because this deployment has no outbound mail. Supabase's built-in email sends two messages an hour and only to the project team's own addresses, so a real invitation needs SMTP configured, which is a deployment decision nobody has taken yet.

This ticket is the delivery: SMTP settings in `docs/configuration.md`, the invitation email itself, and the invitation page reporting that the mail went (or that mail is not configured and the link is the only route).

**Blocked by:** 49.

**Status:** ready-for-agent

- [ ] SMTP configuration documented, and absent configuration reported rather than failing quietly
- [ ] The invitation email carries the link, who invited them, and what the Org is
- [ ] The link in the email is the same one the inviter can copy, not a second token
- [ ] Sending is verified against a real SMTP server, not asserted
