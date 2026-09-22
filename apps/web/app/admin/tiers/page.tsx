import { TierForm } from './tier-form'
import { PageHeader } from '../../(dashboard)/page-header'
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
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title="Tiers"
        description="What each Tier includes. An edit takes effect on the next read — there is nothing to deploy."
      />

      <section>
        <h2 className="text-heading">Defined</h2>
        {tiers.length === 0 ? (
          <p className="text-text-secondary mt-2 text-body">
            No Tier is defined yet, so no Org can be activated. Create one
            below.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {tiers.map((tier) => (
              <TierForm key={tier.id} tier={tier} orgs={tier.orgs} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-heading">New Tier</h2>
        <p className="text-text-secondary mt-1 text-caption">
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
