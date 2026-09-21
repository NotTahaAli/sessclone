import { notFound } from 'next/navigation'

import { ActivateForm } from './activate-form'
import { PageHeader } from '../../../(dashboard)/page-header'
import { asOperator } from '../../../../lib/platform-admin'
import { listTiers } from '../../../../lib/tier-admin'
import { adminOrg, subscriptionHistory } from '../../../../lib/subscriptions'

// Tickets 48 and 65: one Org's subscription, and everything that has happened
// to it.
//
// The form and the history are on one page because they are one thing. An
// activation with no payment rail behind it is somebody's decision, and the
// only thing that makes that safe to live with is that the decision is written
// down next to the control that takes it.
//
// The event is not written here and cannot be skipped here: it is a trigger on
// `subscriptions` (ticket 47's schema), so a row written by this form, by a
// provider's webhook in v2, or by hand in psql all leave the same trail.

export default async function Page({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = await params

  // One transaction: the Org, the Tiers it could be put on, and what has
  // happened to it. `orgs_read` is what decides the first of them comes back
  // at all, so an Org this caller may not read is a 404 rather than a refusal.
  const { org, tiers, history } = await asOperator(async (tx) => ({
    org: await adminOrg(tx, orgId),
    tiers: await listTiers(tx),
    history: await subscriptionHistory(tx, orgId),
  }))

  if (!org) notFound()

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title={org.name}
        description={`${org.seats} ${org.seats === 1 ? 'seat' : 'seats'} in use · ${
          org.tierName ? `${org.tierName}, ${org.status}` : 'no Tier yet'
        }`}
      />

      <section>
        <h2 className="text-heading">Subscription</h2>
        <p className="text-text-secondary mt-1 text-caption">
          There is no payment rail in v1, so this is the record of a decision
          somebody took. Say why in the note.
        </p>
        <div className="mt-3">
          <ActivateForm
            orgId={org.id}
            tiers={tiers}
            tierId={org.tierId}
            status={org.status}
          />
        </div>
      </section>

      <section>
        <h2 className="text-heading">History</h2>
        {history.length === 0 ? (
          <p className="text-text-secondary mt-2 text-body">
            Nothing has happened to this subscription yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {history.map((event) => (
              <li
                key={event.id}
                className="border-rule bg-surface rounded-md border p-3"
              >
                <p className="text-body">
                  {event.tierName} · {event.status}
                </p>
                <p className="text-text-muted text-caption">
                  {event.occurredAt
                    .toISOString()
                    .slice(0, 16)
                    .replace('T', ' ')}{' '}
                  UTC · {event.actorEmail ?? event.provider}
                </p>
                {event.note ? (
                  <p className="text-text-secondary mt-1 text-caption">
                    {event.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
