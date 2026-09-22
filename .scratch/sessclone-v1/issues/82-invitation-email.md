# 82: Send the invitation by email

**What to build:** Ticket 49 builds the invitation itself — the token, the acceptance, the seat check — and hands the inviter a link to pass on, because this deployment has no outbound mail. Supabase's built-in email sends two messages an hour and only to the project team's own addresses, so a real invitation needs SMTP configured, which is a deployment decision nobody has taken yet.

This ticket is the delivery: SMTP settings in `docs/configuration.md`, the invitation email itself, and the invitation page reporting that the mail went (or that mail is not configured and the link is the only route).

**Blocked by:** 49.

**Status:** done

- [x] SMTP configuration documented, and absent configuration reported rather than failing quietly
- [x] The invitation email carries the link, who invited them, and what the Org is
- [x] The link in the email is the same one the inviter can copy, not a second token
- [x] Sending is verified against a real SMTP server, not asserted

## What landed

`apps/web/lib/mailer.ts` — the app's own SMTP, used only for the invitation
email. `SMTP_URL` (a connection URL nodemailer parses: `smtp://…:587` STARTTLS,
`smtps://…:465` TLS) and `SMTP_FROM`, both optional and both-or-neither. Server
only, so the credential in `SMTP_URL` reaches no page or log line. Documented
in `docs/configuration.md` and `.env.example`; the config-contract test covers
the pair.

`sendInvite` (the Members-page action) now mails the link after creating the
invitation and returns a `delivery` of `sent` / `not-configured` / `failed`.
The link is shown in every case — the same token the email carries, never a
second one — so a missing or failed send loses nothing; the inviter passes it
on. The invite form's line reflects which happened.

Verified against a real `smtp-server` listener (`apps/web/test/mailer.test.ts`),
not a mocked transport: the delivered message's envelope and body are read back
and asserted to carry the link, the Org and the inviter, and the HTML part is
checked to escape the Org name. A refusing server and an unreachable one both
resolve to `failed` rather than throwing.

Not re-screenshotted: the only surface change is one conditional sentence
inside the already-verified invite result panel; markup and styles are
otherwise unchanged.
