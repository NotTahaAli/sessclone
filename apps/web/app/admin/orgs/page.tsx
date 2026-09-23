import { PageHeader } from '../../(dashboard)/page-header'
import { Row, SectionBreak } from '../../_ui/primitives'
import { asOperator } from '../../../lib/platform-admin'
import { listOrgs, ORG_PAGE, type AdminOrg } from '../../../lib/subscriptions'
import { TextFilter } from '../text-filter'

// Tickets 48 and 65: every Org in the deployment, and what it is on.
//
// The list answers the operator's standing question — who is active, who is
// waiting, how many Seats each is using — and nothing more. Activating one is
// its own page, because it takes a Tier, a status and a note, and because the
// record it writes deserves the page that shows the history beside it.

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>
}) {
  const { name } = await searchParams
  const filter = name?.trim() ?? ''
  const { orgs, more } = await asOperator((tx) =>
    listOrgs(tx, { name: filter || null }),
  )

  // The statement already puts the waiting ones first (ticket 120); the page
  // only draws the break between them and the rest.
  const waiting = orgs.filter((org) => org.pending).length
  const others = orgs.length - waiting

  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Orgs" />
      <div className="mt-3">
        <TextFilter
          name="name"
          label="Filter by name or admin name"
          value={filter}
          placeholder="acme"
          clearHref="/admin/orgs"
        />
      </div>

      {orgs.length === 0 ? (
        <p className="text-text-muted py-3 text-body">No Org matches that.</p>
      ) : null}

      {waiting > 0 ? (
        <>
          <SectionBreak>Waiting for approval</SectionBreak>
          <OrgRows orgs={orgs} pending />
        </>
      ) : null}
      {others > 0 ? (
        <>
          <SectionBreak>
            {waiting > 0 ? 'Every other Org' : 'Orgs'}
          </SectionBreak>
          <OrgRows orgs={orgs} pending={false} />
        </>
      ) : null}

      {more ? (
        <p className="text-text-muted mt-3 text-caption">
          Only the first {ORG_PAGE} Orgs are shown — narrow the filter.
        </p>
      ) : null}
    </div>
  )
}

function OrgRows({ orgs, pending }: { orgs: AdminOrg[]; pending: boolean }) {
  return (
    <ol>
      {orgs
        .filter((org) => org.pending === pending)
        .map((org) => (
          <li key={org.id}>
            {/* Ticket 102: the admin name leads, the Org's own under it. No
              subscription is a state rather than a missing value: v1 ships
              no payment rail, so an Org is un-activated until an operator
              gets to it (ADR 0004). */}
            <Row
              href={`/admin/orgs/${org.id}`}
              name={org.operatorName ?? org.name}
              meta={
                org.tierName ? `${org.tierName} · ${org.status}` : 'no Tier'
              }
              sub={`${org.operatorName ? `${org.name} · ` : ''}${org.seats} ${
                org.seats === 1 ? 'seat' : 'seats'
              } · since ${org.createdAt.toISOString().slice(0, 10)}${
                org.requestedSeats && org.requestedSeats > 1
                  ? ` · asked for ${org.requestedSeats} seats`
                  : ''
              }`}
            />
          </li>
        ))}
    </ol>
  )
}
