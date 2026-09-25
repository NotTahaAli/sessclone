import Link from 'next/link'

import { canonical, siteHost } from '../../../lib/site'
import { ClarityChoice } from '../clarity'
import { REPOSITORY } from '../constants'
import { Contact, Legal } from '../legal'

export const metadata = {
  title: 'Privacy',
  description:
    'What the hosted SessClone service collects, where it is kept, and who can see it.',
  alternates: { canonical: canonical('/privacy') },
}

// Facts here are the code's, checked 2026-09-25: Collector fields in
// `packages/plugin/src/shared/turns.ts`, archival default in
// `supabase/migrations/20260920120000_accounts.sql`, retention in
// `lib/retention.ts`, Tier limits in
// `supabase/migrations/20260925190100_tier_limits.sql`, account deletion in
// `lib/account-deletion.ts`, cookies in `lib/appearance.ts` and the Supabase
// client.
// Change the page when any of those change.
export default function Privacy() {
  return (
    <Legal title="Privacy" updated="25 September 2026">
      <p>
        This page covers the service at {siteHost()}. SessClone is open source:
        a copy you run yourself keeps your data on your own database and
        storage.
      </p>

      <h2>Who we are</h2>
      <p>
        The service at {siteHost()} is run by its operator, who decides how the
        data below is used. Write to <Contact /> about anything on this page.
        The source code is at <a href={REPOSITORY}>GitHub</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account.</strong> Your email address, and your GitHub
          identity if you sign in with GitHub.
        </li>
        <li>
          <strong>Usage the Collector reports.</strong> For each Claude Code
          Turn: the model, token counts, timestamps, session, request and
          message ids, the Claude Code version, the working directory, the git
          branch and remote, and the name of the machine it ran on. When a
          request fails, the error Claude Code reported. No prompt or response
          text.
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
        A Member sees their own usage. Owners and Admins see every Member&apos;s
        usage and archived transcripts, and can download them; a Manager sees
        the same for the Members in their scope. Nobody outside your Org can
        read any of it: the database enforces that on every query. The operator
        can reach the database to run the service and uses that only to operate,
        secure and support it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Transcripts are deleted after your Org&apos;s retention period, which an
        Owner sets within the plan&apos;s limit: 90 days on Team, the agreed
        term on Enterprise. Personal stores no transcripts; after a move to
        Personal, stored ones are kept 7 days and then deleted. Usage records
        are the Org&apos;s spend history and are kept while the Org exists; a
        plan may show only recent ones, but hides the rest rather than deleting
        them.
      </p>
      <p>
        You can delete your account from Settings. It is removed 14 days later,
        and signing in before then keeps it. Deletion removes your name, email
        address, memberships, API keys and stored transcripts. The usage records
        of Turns you ran stay in each Org&apos;s spend history under a label
        that no longer names you. To have an Org deleted, email us.
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
          on the marketing pages and the docs, and, later, transcript storage.
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
          Clarity&apos;s cookies, on the marketing pages. Where your browser
          looks European, or hides its time zone, we ask first, and if you say
          no Clarity does not load. The answer is kept in your browser&apos;s
          local storage. You can change it here at any time:
          <ClarityChoice />
        </li>
        <li>The transcript viewer remembers column widths in local storage.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, a correction, or deletion, and you
        can object to processing. Email <Contact />. If you are in the EEA or
        the UK you can also complain to your data protection authority.
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
