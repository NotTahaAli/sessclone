import { Field, SectionBreak } from '../../../_ui/primitives'
import {
  agreedPrice,
  isActive,
  retentionCeiling,
  shownCapabilities,
  type OrgTier,
} from '../../../../lib/tier'
import { tierPrice, tierSeats } from '../../../../lib/tiers'

// The Tier page's body, apart from its read (ticket 47, 113).

export function Tier({ tier }: { tier: OrgTier }) {
  const price = tierPrice(tier)
  const agreed = agreedPrice(tier)
  const active = isActive(tier)

  return (
    <>
      <SectionBreak>Plan</SectionBreak>
      <Field label="Tier" hint={tier.description ?? undefined}>
        {tier.name}
      </Field>
      {/* The price agreed with this Org wins over the Tier's published one
          (or Enterprise's "Contact"), on any Tier. */}
      <Field label="Price" hint={agreed ? 'Agreed for your Org' : undefined}>
        {agreed ??
          (price.unit ? `${price.amount} ${price.unit}` : price.amount)}
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
 * a data change, not a migration): the plan's includes lines as plain rows,
 * then each named flag that is on. `shownCapabilities` decides what is said;
 * a key it has no name for is left out rather than printed raw.
 */
function Capabilities({ features }: { features: Record<string, unknown> }) {
  const { includes, flags } = shownCapabilities(features)

  if (includes.length === 0 && flags.length === 0) return null

  return (
    <>
      <SectionBreak>Also on this Tier</SectionBreak>
      <ul>
        {includes.map((line) => (
          <li key={line} className="py-[11px] text-body">
            {line}
          </li>
        ))}
      </ul>
      {flags.map((flag) => (
        <Field key={flag.label} label={flag.label}>
          {flag.value ?? '✓'}
        </Field>
      ))}
    </>
  )
}
