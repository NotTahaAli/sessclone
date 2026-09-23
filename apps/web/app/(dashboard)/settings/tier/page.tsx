import { notFound } from 'next/navigation'

import { EmptyState } from '../../empty-state'
import { PageHeader } from '../../page-header'
import { Field, SectionBreak } from '../../../_ui/primitives'
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

function Tier({ tier }: { tier: OrgTier }) {
  const price = tierPrice(tier)
  const active = isActive(tier)

  return (
    <>
      <SectionBreak>Plan</SectionBreak>
      <Field label="Tier" hint={tier.description ?? undefined}>
        {tier.name}
      </Field>
      <Field label="Price">
        {price.unit ? `${price.amount} ${price.unit}` : price.amount}
      </Field>
      {/* Status beside the Tier, never behind it. An Org on the Team Tier
          with a cancelled subscription is on the Team Tier and entitled to
          nothing, and a page that showed only the name would say the
          opposite. */}
      <Field label="Status">
        <Status active={active} status={tier.status} />
      </Field>

      <SectionBreak>What it includes</SectionBreak>
      {/* A Seat is a person and not a machine, so this counts Members. */}
      <Field
        label="Seats"
        hint={`${tierSeats(tier)}${
          // Full only where the database would refuse the next Member.
          tier.seatCeiling !== null && tier.seatsUsed >= tier.seatCeiling
            ? ', and every one is in use'
            : ''
        }${
          // The allowance the base price covers, a different number from
          // the ceiling on a Tier that charges per seat above it.
          tier.includedSeats > 0 && tier.includedSeats !== tier.maxSeats
            ? `. ${tier.includedSeats} included in the price`
            : ''
        }.`}
      >
        {tier.maxSeats === null
          ? `${tier.seatsUsed} in use`
          : `${tier.seatsUsed} of ${tier.maxSeats}`}
      </Field>

      {/* Said plainly in both directions, which is ticket 47's own wording.
          "Archival available" with nothing beside it reads as available. */}
      <Field
        label="Transcript archival"
        hint={
          tier.archivalAvailable
            ? 'Each Member still turns it on for themselves; nobody can turn it on for them.'
            : 'Usage and cost are still collected; session transcripts are not uploaded.'
        }
      >
        {tier.archivalAvailable ? 'available' : 'not on this Tier'}
      </Field>

      {/* The ceiling bounds a setting the Owner controls (ticket 61), so
          reading one without the other is reading half a rule. */}
      <Field
        label="Retention ceiling"
        hint="Your own retention setting, in Org settings, sits under it."
      >
        {retentionCeiling(tier)}
      </Field>

      <Capabilities features={tier.features} />
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
  if (active) return <span className="text-ok-text text-[13px]">✓ Active</span>

  // Each of the three says what is true rather than what went wrong: none of
  // them is an error, and two of them are ordinary.
  const said: Record<string, string> = {
    inactive: 'Not activated yet. Nothing on this Tier applies until it is.',
    past_due: 'Past due. The Tier still applies; the account needs attention.',
    cancelled: 'Cancelled. This Tier no longer applies.',
  }

  return (
    <span className="text-warn-text text-right text-[13px]">
      {said[status] ?? status}
    </span>
  )
}

/**
 * Every further gate, read from the Tier row (ADR 0004: the next capability is
 * a data change, not a migration). What is off is not listed, and the key is
 * shown as written, because inventing prose for a key this code has never seen
 * is how a page starts lying about what a Tier includes.
 *
 * Anything that is not `false` or null counts as on, and a value that is not
 * `true` is shown as the row's value. A gate added as a number
 * (`{"max_projects": 50}`) is exactly the case ADR 0004 promises needs no
 * deployment, and a filter for `=== true` would have dropped it silently.
 */
function Capabilities({ features }: { features: Record<string, unknown> }) {
  const on = Object.entries(features).filter(
    ([, value]) => value !== false && value !== null && value !== undefined,
  )

  if (on.length === 0) return null

  return (
    <>
      <SectionBreak>Also on this Tier</SectionBreak>
      {on.map(([key, value]) => (
        <Field key={key} label={key.replaceAll('_', ' ')}>
          {value === true ? '✓' : String(value)}
        </Field>
      ))}
    </>
  )
}
