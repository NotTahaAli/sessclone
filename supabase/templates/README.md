# Supabase Auth email templates

Supabase Auth sends the sign-in emails, and the hosted project reads its
templates from the dashboard, not from this folder. These files are the
source: `apps/web/test/email-templates.test.ts` renders them from the same
layout as the app's own mail (`apps/web/lib/email-layout.ts`) and fails when a
file here and the layout disagree. To change one, edit the copy in that test or
the layout, run `pnpm vitest run -u test/email-templates.test.ts` in `apps/web`,
and paste the changed file into the dashboard.

In the dashboard, open Authentication > Emails, pick the template, set the
subject, and paste the whole file as the message body:

| Template             | File                    | Subject                              |
| -------------------- | ----------------------- | ------------------------------------ |
| Confirm sign up      | `confirmation.html`     | Confirm your email for SessClone     |
| Magic link           | `magic_link.html`       | Your SessClone sign-in link          |
| Invite user          | `invite.html`           | You are invited to SessClone         |
| Reset password       | `recovery.html`         | Reset your SessClone password        |
| Change email address | `email_change.html`     | Confirm your new email for SessClone |
| Reauthentication     | `reauthentication.html` | Your SessClone verification code     |

The app itself sends only the first two: `signInWithOtp` sends Confirm sign up
to an address Supabase has not seen and Magic link to one it has. The
`{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` and `{{ .Token }}`
placeholders are Supabase's template variables.

A self-hosted deployment running the Supabase CLI can point
`[auth.email.template.<name>]` in its `config.toml` at these files instead.
