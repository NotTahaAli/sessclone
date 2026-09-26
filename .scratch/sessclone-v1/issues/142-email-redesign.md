# 142: Emails in the product's own look

**What to build:** Taha, 2026-09-26: find every email the app sends, through its own SMTP (Resend) or through Supabase Auth, and redesign them to match the theme. Drafts first.

**What was picked (Taha, 2026-09-26).** Direction A, "Log": no card, one accent button, a table of label and mono value rows, the paste-able link under it, a text Σ mark with an accent underline (no images). Light by default, dark through `prefers-color-scheme`. All six Supabase Auth templates styled, not only the two the app triggers today.

The emails:

- App SMTP (`apps/web/lib/mailer.ts`): the Org invitation, and the "waiting for approval" notice to platform admins.
- Supabase Auth: Confirm sign up and Magic link (sent by `signInWithOtp`), plus Invite user, Reset password, Change email address and Reauthentication, which nothing in the app sends yet.

**Blocked by:** none

**Status:** done

- [x] Shared layout, `apps/web/lib/email-layout.ts`
- [x] Invitation and sign-up notice rendered through it; invitation shows the Role
- [x] Six Supabase templates in `supabase/templates/`, generated from the same layout, drift fails `test/email-templates.test.ts`
- [x] Templates pasted into the hosted project (Authentication > Emails), Taha, 2026-09-26
