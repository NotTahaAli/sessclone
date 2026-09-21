import Link from 'next/link'

import { PageHeader } from '../../(dashboard)/page-header'
import { asOperator } from '../../../lib/platform-admin'
import { listOrgs } from '../../../lib/subscriptions'

// Tickets 48 and 65: every Org in the deployment, and what it is on.
//
// The list answers the operator's standing question — who is active, who is
// waiting, how many Seats each is using — and nothing more. Activating one is
// its own page, because it takes a Tier, a status and a note, and because the
// record it writes deserves the page that shows the history beside it.

export default async function Page() {
  const { orgs, more } = await asOperator((tx) => listOrgs(tx))

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Orgs"
        description="Every Org on this deployment, newest first."
      />

      <ul className="flex flex-col gap-2">
        {orgs.map((org) => (
          <li key={org.id}>
            <Link
              href={`/admin/orgs/${org.id}`}
              className="border-rule bg-surface flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border p-3"
            >
              <div>
                <p className="text-body">{org.name}</p>
                <p className="text-text-muted text-caption">
                  {org.seats} {org.seats === 1 ? 'seat' : 'seats'} · since{' '}
                  {org.createdAt.toISOString().slice(0, 10)}
                </p>
              </div>
              <p className="text-text-secondary text-caption">
                {/* No subscription is a state rather than a missing value: v1
                    ships no payment rail, so an Org is un-activated until an
                    operator gets to it (ADR 0004). */}
                {org.tierName ? `${org.tierName} · ${org.status}` : 'no Tier'}
              </p>
            </Link>
          </li>
        ))}
      </ul>

      {more ? (
        <p className="text-text-muted text-caption">
          Only the first 50 Orgs are shown.
        </p>
      ) : null}
    </div>
  )
}
