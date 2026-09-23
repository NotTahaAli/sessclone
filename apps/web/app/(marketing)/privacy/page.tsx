import Link from 'next/link'

import { canonical } from '../../../lib/site'
import { CONTACT_EMAIL, REPOSITORY } from '../constants'
import { Legal } from '../legal'

export const metadata = {
  title: 'Privacy',
  description:
    'What the hosted SessClone service collects, where it is kept, and who can see it.',
  alternates: { canonical: canonical('/privacy') },
}

// Facts here are the code's, checked 2026-09-23: Collector fields in
// `packages/plugin/src/shared/turns.ts`, archival default in
// `supabase/migrations/20260920120000_accounts.sql`, retention in
// `lib/retention.ts`, cookies in `lib/appearance.ts` and the Supabase client.
// Change the page when any of those change.
export default function Privacy() {
  return (
    <Legal title="Privacy" updated="23 September 2026">
      <p>
        This page covers the hosted service at sessclone.com. If you run
        SessClone yourself, your data stays on your own database and storage and
        none of it reaches us.
      </p>

      <h2>Who we are</h2>
      <p>
        SessClone is an open-source project run by its maintainer (
        <a href={REPOSITORY}>github.com/NotTahaAli</a>). Write to{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> about anything
        on this page.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your email address, and your GitHub
          identity if you sign in with GitHub.
        </li>
        <li>
          <strong>Usage the Collector reports.</strong> For each Claude Code
          Turn: the model, token counts, timestamps, session and request ids,
          the working directory, the git branch and the machine it ran on. No
          prompt or response text.
        </li>
        <li>
          <strong>Transcripts, only if you turn them on.</strong> Archiving is
          off by default. Each Member turns it on for themselves, and can leave
          out any Project. Transcripts contain source code and whatever else was
          in the session, so switch it on only where that is acceptable.
        </li>
        <li>
          <strong>Org details.</strong> Org names, logos, invitations, roles and
          settings.
        </li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Members of your Org see the Org&apos;s usage. Owners and Admins see
        every Member; a Manager sees the Members in their scope. Nobody outside
        your Org can read it: the database enforces that on every query. The
        maintainer can reach the database to run the service and uses that only
        to operate, secure and support it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Transcripts are deleted after your Org&apos;s retention period (90 days
        unless an Owner changes it, within your plan&apos;s limit). Usage
        records are the Org&apos;s spend history and are kept while the Org
        exists. To have an account or an Org deleted, email us; there is no
        self-serve deletion yet.
      </p>

      <h2>Services we use</h2>
      <ul>
        <li>Vercel hosts the application.</li>
        <li>
          Supabase provides the database, sign-in and, for now, transcript
          storage, in Singapore.
        </li>
        <li>
          Cloudflare provides DNS, email forwarding, cookieless page analytics
          and, later, transcript storage.
        </li>
        <li>GitHub, if you sign in with it.</li>
        <li>An email provider sends sign-in links and invitations.</li>
        <li>
          Microsoft Clarity records how visitors use the marketing pages, never
          the dashboard. It masks typed input by default.
        </li>
      </ul>
      <p>We do not sell data or show ads.</p>

      <h2>Cookies and local storage</h2>
      <ul>
        <li>Sign-in cookies keep you signed in. They are required.</li>
        <li>
          <code>sessclone-appearance</code> remembers your theme and accent.
        </li>
        <li>
          Clarity&apos;s cookies, on the marketing pages. In Europe we ask
          first; if you say no, Clarity does not load. The answer is kept in
          your browser&apos;s local storage; clear site data to be asked again.
        </li>
        <li>The transcript viewer remembers column widths in local storage.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, a correction, or deletion, and you
        can object to processing. Email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If you are in
        the EEA or the UK you can also complain to your data protection
        authority.
      </p>

      <h2>Children</h2>
      <p>SessClone is for people 18 and over.</p>

      <h2>Changes</h2>
      <p>
        We change this page when the service changes, and the date above says
        when. The <Link href="/terms">Terms</Link> cover everything else.
      </p>
    </Legal>
  )
}
