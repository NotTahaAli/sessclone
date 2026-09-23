import Link from 'next/link'

import { canonical } from '../../../lib/site'
import { CONTACT_EMAIL, REPOSITORY } from '../constants'
import { Legal } from '../legal'

export const metadata = {
  title: 'Terms',
  description: 'The terms for using the hosted SessClone service.',
  alternates: { canonical: canonical('/terms') },
}

export default function Terms() {
  return (
    <Legal title="Terms" updated="23 September 2026">
      <p>
        These terms cover the hosted service at sessclone.com. By creating an
        account you agree to them. The source code is separate: it is licensed
        under the <a href={`${REPOSITORY}/blob/main/LICENSE`}>AGPL-3.0</a> with
        the additional term in{' '}
        <a href={`${REPOSITORY}/blob/main/NOTICE.md`}>NOTICE.md</a>, and nothing
        here limits that licence.
      </p>

      <h2>The service</h2>
      <p>
        The hosted service is free while it is new. Paid plans are a waitlist
        for now; before any plan charges you, you will see its price and agree
        to it. New Orgs wait for approval before they can collect.
      </p>

      <h2>Your account</h2>
      <p>
        Keep your sign-in and API keys to yourself, and revoke a key you think
        has leaked. You are responsible for what happens under your account and
        for the Members you invite. You must be 18 or over.
      </p>

      <h2>Your data</h2>
      <p>
        What you send stays yours. You let us store and process it to run the
        service, as the <Link href="/privacy">Privacy</Link> page describes.
        Only send transcripts you are allowed to share with your Org.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No attacks on the service or on other Orgs.</li>
        <li>No use that breaks the law or Anthropic&apos;s terms.</li>
        <li>No load that makes the service worse for everybody else.</li>
      </ul>
      <p>We may suspend an account that breaks these rules.</p>

      <h2>No warranty</h2>
      <p>
        The service is provided as is. Cost figures are estimates from published
        rates and may differ from your invoice from Anthropic or your cloud
        provider. As far as the law allows, we are not liable for indirect
        losses or lost data, and our total liability is limited to what you paid
        us in the last twelve months.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop at any time, and email us to delete your account or Org. We
        may end the service with notice to your email address, and you will have
        time to export your data first.
      </p>

      <h2>Changes</h2>
      <p>
        We will say when these terms change, by email for material changes.
        Questions go to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </Legal>
  )
}
