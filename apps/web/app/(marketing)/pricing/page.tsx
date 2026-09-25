import { FRAME } from '../constants'
import { DemoLink } from '../demo-link'
import { canonical } from '../../../lib/site'
import { TiersUnavailable } from '../tiers-unavailable'
import { PlanPicker, type Plan } from './plan-picker'
import { comparison, isFree, planLines } from '../../../lib/plans'
import {
  marketingTiers,
  tierRetention,
  type MarketingTier,
} from '../../../lib/tiers'

// The pricing page (ticket 115): a team-size slider that marks the plan that
// fits, the plans with what each costs at that size, and a comparison below.
// Every price, seat range and line is read from the `tiers` table on this
// render; nothing here restates one.
export const metadata = {
  title: 'Pricing',
  alternates: { canonical: canonical('/pricing') },
  description:
    'Pay per person, not per machine. Self-hosting is free at any size.',
}

export default async function Pricing() {
  const { plans, rows } = pricing(await marketingTiers())

  return (
    <div className={`${FRAME} pt-4 pb-12 lg:pt-10 lg:pb-16`}>
      {plans.length === 0 ? (
        <>
          <Intro />
          <TiersUnavailable />
        </>
      ) : (
        <PlanPicker plans={plans} rows={rows}>
          <Intro />
        </PlanPicker>
      )}
    </div>
  )
}

/** The plans and the comparison, from the rows. Paid plans first, in sort
 * order, then the free one: the slider's answer leads, and Self-Hosted is
 * always there under it. */
const pricing = (tiers: MarketingTier[]) => {
  const ordered = [
    ...tiers.filter((tier) => !isFree(tier)),
    ...tiers.filter(isFree),
  ]
  return { plans: ordered.map(toPlan), rows: comparison(ordered) }
}

const toPlan = (tier: MarketingTier): Plan => ({
  key: tier.key,
  name: tier.name,
  description: tier.description,
  basePriceUsd: tier.basePriceUsd,
  seatPriceUsd: tier.seatPriceUsd,
  includedSeats: tier.includedSeats,
  minSeats: tier.minSeats,
  maxSeats: tier.maxSeats,
  lines: planLines(tier, tierRetention(tier)),
})

const Intro = () => (
  <>
    <h1 className="text-[28px] leading-[1.08] font-semibold tracking-[-0.025em] text-balance lg:text-[44px] lg:tracking-[-0.035em]">
      Pay per person, not per machine.
    </h1>
    <p className="text-text-muted mt-3 mb-4 text-[14.5px] lg:text-[17px]">
      Every laptop, cloud session and CI job a person runs counts once. Slide to
      your team size and the plan that fits is marked.
    </p>
    <DemoLink block />
  </>
)
