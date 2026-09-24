import { TierForm } from './tier-form'
import { PageHeader } from '../../(dashboard)/page-header'
import { SectionBreak } from '../../_ui/primitives'
import { asOperator } from '../../../lib/platform-admin'
import { listTiers } from '../../../lib/tier-admin'

// Ticket 65: what each Tier includes, as rows rather than as a release.
//
// Every field on this page is a column on `tiers`, and every entitlement check
// in the app reads those columns (ADR 0004, `lib/tier.ts`). That is the whole
// design: changing what the Team Tier includes is an edit here and takes
// effect on the next read, with nothing to deploy and no cache to clear.

export default async function Page() {
  const tiers = await asOperator((tx) => listTiers(tx))

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Tiers" />
      <p className="text-text-muted mt-3 text-caption">
        What each Tier includes. An edit takes effect on the next read — there
        is nothing to deploy.
      </p>

      {tiers.length === 0 ? (
        <p className="text-text-muted py-3 text-body">
          No Tier is defined yet, so no Org can be activated. Create one below.
        </p>
      ) : (
        // One section per Tier, headed by its name: the break is the only
        // divider, as on every Direction A page.
        tiers.map((tier) => (
          <section key={tier.id}>
            <SectionBreak>{tier.name}</SectionBreak>
            <TierForm tier={tier} orgs={tier.orgs} />
          </section>
        ))
      )}

      <section>
        <SectionBreak>New Tier</SectionBreak>
        <p className="text-text-muted mt-1 text-caption">
          The key is what code and support both name it by, and it does not
          change afterwards. Both prices empty means &ldquo;contact us&rdquo;.
        </p>
        <div className="mt-3">
          <TierForm />
        </div>
      </section>
    </div>
  )
}
