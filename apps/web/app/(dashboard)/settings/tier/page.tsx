import { notFound } from 'next/navigation'

import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'
import { asViewer } from '../../../../lib/db'
import {
  isActive,
  orgTier,
  retentionCeiling,
  type OrgTier,
} from '../../../../lib/tier'
import { tierPrice, tierSeats } from '../../../../lib/tiers'
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

export default async function TierPage() {
  const viewer = await currentViewer()
  if (!viewer || !reachesTier(viewer.role)) notFound()

  const tier = await asViewer(viewer.userId, (tx) => orgTier(tx, viewer.orgId))

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Tier"
        description={`What ${viewer.orgName} is on, and what it includes.`}
      />
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

function Tier({ tier }: { tier: OrgTier }) {
  const price = tierPrice(tier)
  const active = isActive(tier)

  return (
    <>
      <section
        aria-labelledby="tier"
        className="border-rule bg-surface rounded-md border p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="tier" className="text-heading-lg">
            {tier.name}
          </h2>
          <p className="text-heading">
            {price.amount}
            {price.unit ? (
              <span className="text-text-muted text-sm"> {price.unit}</span>
            ) : null}
          </p>
        </div>

        {tier.description ? (
          <p className="text-text-secondary mt-2 text-sm">{tier.description}</p>
        ) : null}

        {/* Status beside the Tier, never behind it. An Org on the Team Tier
            with a cancelled subscription is on the Team Tier and entitled to
            nothing, and a page that showed only the name would say the
            opposite. */}
        <p className="mt-4 text-sm">
          <Status active={active} status={tier.status} />
        </p>
      </section>

      <section aria-labelledby="includes" className="flex flex-col gap-3">
        <h2 id="includes" className="text-heading-lg">
          What it includes
        </h2>

        <Fact label="Seats">
          {tierSeats(tier)}
          {/* A Seat is a person and not a machine, so this counts Members. */}
          <span className="text-text-muted">
            {' '}
            — {tier.seatsUsed} in use
            {tier.maxSeats !== null && tier.seatsUsed >= tier.maxSeats
              ? ', which is the limit'
              : ''}
            {/* The allowance the base price covers, which is a different
                number from the ceiling on a Tier that charges per seat above
                it. Shown only when it says something the line above does
                not. */}
            {tier.includedSeats > 0 && tier.includedSeats !== tier.maxSeats
              ? `, ${tier.includedSeats} included in the price`
              : ''}
          </span>
        </Fact>

        {/* Said plainly in both directions, which is ticket 47's own wording.
            "Archival available" with nothing beside it reads as available. */}
        <Fact label="Transcript archival">
          {tier.archivalAvailable
            ? 'Available. Each Member still turns it on for themselves; nobody can turn it on for them.'
            : 'Not available on this Tier. Usage and cost are still collected; session transcripts are not uploaded.'}
        </Fact>

        {/* The ceiling is here because it bounds a setting the Owner controls
            (ticket 61), so reading one without the other is reading half a
            rule. */}
        <Fact label="Retention ceiling">
          {retentionCeiling(tier)}
          <span className="text-text-muted">
            {' '}
            — your own retention setting sits under it.
          </span>
        </Fact>

        <Capabilities features={tier.features} />
      </section>
    </>
  )
}

function Status({
  active,
  status,
}: {
  active: boolean
  status: OrgTier['status']
}) {
  if (active) return <span className="text-ok-text">Active</span>

  // Each of the three says what is true rather than what went wrong: none of
  // them is an error, and two of them are ordinary.
  const said: Record<string, string> = {
    inactive: 'Not activated yet. Nothing on this Tier applies until it is.',
    past_due: 'Past due. The Tier still applies; the account needs attention.',
    cancelled: 'Cancelled. This Tier no longer applies.',
  }

  return <span className="text-warn-text">{said[status] ?? status}</span>
}

/**
 * Every further gate, read from the Tier row (ADR 0004: the next capability is
 * a data change, not a migration). What is off is not listed — a list of
 * things you do not have is a worse page than a shorter one — and the key is
 * shown as written, because inventing prose for a key this code has never seen
 * is how a page starts lying about what a Tier includes.
 *
 * Anything that is not `false` or null counts as on, and a value that is not
 * `true` is shown beside its key. A gate added as a number (`{"max_projects":
 * 50}`) is exactly the case ADR 0004 promises needs no deployment, and a
 * filter for `=== true` would have dropped it off this page silently.
 */
function Capabilities({ features }: { features: Record<string, unknown> }) {
  const on = Object.entries(features).filter(
    ([, value]) => value !== false && value !== null && value !== undefined,
  )

  if (on.length === 0) return null

  return (
    <Fact label="Also on this Tier">
      <ul className="flex flex-col gap-1">
        {on.map(([key, value]) => (
          <li key={key}>
            {key.replaceAll('_', ' ')}
            {value === true ? '' : `: ${String(value)}`}
          </li>
        ))}
      </ul>
    </Fact>
  )
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="border-rule rounded-md border p-4">
      <h3 className="text-label text-text-muted uppercase">{label}</h3>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  )
}
