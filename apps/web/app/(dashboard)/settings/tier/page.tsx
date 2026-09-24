import { notFound } from 'next/navigation'

import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'
import { Tier } from './tier-view'
import { asViewer } from '../../../../lib/db'
import { orgTier } from '../../../../lib/tier'
import { currentViewer, reachesTier } from '../../../../lib/viewer'

// Ticket 47: what the Org is on, what it includes, and what it does not.
//
// Owner only. `docs/design/product-ia.md` settles it: Org settings is Owner or
// Admin, and this is the one page inside it an Admin does not reach, because
// `CONTEXT.md` gives an Admin the whole Org's data and settings with billing
// as the only exclusion. The entry is absent from an Admin's navigation rather
// than present and refused, and this guard is what makes that true of the URL
// as well as of the link.
//
// Every capability shown here is read from the Tier row. There is deliberately
// no map from a Tier key to a list of features in this file: ticket 47's last
// criterion is that a change to what a Tier includes needs no deployment, and
// a key compared in code is exactly that deployment.
//
// Ticket 113: rows, label left and value right, nothing to edit — a Tier is
// set by whoever operates the deployment.

export default async function TierPage() {
  const viewer = await currentViewer()
  if (!viewer || !reachesTier(viewer.role)) notFound()

  const tier = await asViewer(viewer.userId, (tx) => orgTier(tx, viewer.orgId))

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Tier" back="/settings" />
      {tier ? <Tier tier={tier} /> : <NoTier />}
    </div>
  )
}

/**
 * No subscription row at all, which is a real state rather than an error.
 *
 * v1 ships no payment rail (ADR 0004) and activation is a Platform Admin's
 * manual act (ticket 48), so a new Org has not had one. Saying so beats
 * inventing a default Tier, which would be an entitlement nobody granted.
 */
function NoTier() {
  return (
    <EmptyState headline="No Tier yet">
      Collection works without one. A Tier is set by whoever operates this
      deployment, and nothing on this page changes until they set it.
    </EmptyState>
  )
}
