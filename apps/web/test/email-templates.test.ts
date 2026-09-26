import { expect, test } from 'vitest'

import { renderLayout, type EmailLayout } from '../lib/email-layout'

// Supabase Auth sends the sign-in emails, from templates that live in the
// project's dashboard (Authentication > Emails), not in this repo's runtime.
// The committed copies under `supabase/templates/` are rendered from the same
// layout as the app's own mail, and this test fails when either drifts:
// change the layout or the copy here, run `vitest -u`, and paste the changed
// files into the dashboard. The `{{ . }}` placeholders are Supabase's Go
// template variables, left for Supabase to fill.

const IGNORE = "Didn't ask for this? Ignore it and nothing happens."

const templates: Record<string, EmailLayout> = {
  // Confirm sign up: the first email sign-in for an address Supabase has not
  // seen, which is how `signInWithOtp` creates the user.
  confirmation: {
    title: 'Confirm your email for SessClone',
    heading: 'Confirm your email',
    intro: 'Confirm this address to finish signing in to SessClone.',
    action: { label: 'Confirm and sign in', href: '{{ .ConfirmationURL }}' },
    rows: [['Email', '{{ .Email }}']],
    notes: ['The link works once and expires soon.', IGNORE],
  },
  // Magic link: every later email sign-in.
  magic_link: {
    title: 'Your SessClone sign-in link',
    heading: 'Sign in to SessClone',
    intro: 'Use this link to sign in. It works once and expires soon.',
    action: { label: 'Sign in', href: '{{ .ConfirmationURL }}' },
    rows: [['Email', '{{ .Email }}']],
    notes: [
      "Didn't ask for this? Ignore it. Nobody can sign in without the link.",
    ],
  },
  // The four below are not sent by the app today; styled so one sent from the
  // dashboard, or by a later feature, does not arrive looking like another
  // product.
  invite: {
    title: 'You are invited to SessClone',
    heading: 'Join SessClone',
    intro: 'You have been invited to create a SessClone account.',
    action: { label: 'Accept invitation', href: '{{ .ConfirmationURL }}' },
    rows: [['Email', '{{ .Email }}']],
    notes: ["Didn't expect this? Ignore it and nothing happens."],
  },
  recovery: {
    title: 'Reset your SessClone password',
    heading: 'Reset your password',
    intro: 'Follow this link to choose a new password.',
    action: { label: 'Reset password', href: '{{ .ConfirmationURL }}' },
    rows: [['Email', '{{ .Email }}']],
    notes: [IGNORE],
  },
  email_change: {
    title: 'Confirm your new email for SessClone',
    heading: 'Confirm your new email',
    intro: 'Confirm to move your SessClone sign-in to the new address.',
    action: { label: 'Confirm new email', href: '{{ .ConfirmationURL }}' },
    rows: [
      ['From', '{{ .Email }}'],
      ['To', '{{ .NewEmail }}'],
    ],
    notes: [IGNORE],
  },
  reauthentication: {
    title: 'Your SessClone verification code',
    heading: 'Your verification code',
    intro: 'Enter this code to confirm it is you. It expires shortly.',
    code: '{{ .Token }}',
    notes: [IGNORE],
  },
}

test.each(Object.entries(templates))(
  'supabase/templates/%s.html matches the layout',
  async (name, layout) => {
    await expect(renderLayout(layout)).toMatchFileSnapshot(
      `../../../supabase/templates/${name}.html`,
    )
  },
)
