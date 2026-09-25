import { SIGNUP_PLANS } from '../../lib/subscriptions'
import { marketingTiers, tierPrice, type MarketingTier } from '../../lib/tiers'
import { SeatStepper } from './seat-stepper'

/** The Tiers a sign-up or a New Org may ask for, as the pricing page shows
 * them. */
export const offeredPlans = async () =>
  (await marketingTiers()).filter((tier) =>
    (SIGNUP_PLANS as readonly string[]).includes(tier.key),
  )

/**
 * The plan radios, and the Team size under Team: sign-up's first step, and
 * the plan a New Org asks for (ticket 136). Posts `plan` and `seats`, which
 * `parsePlan` reads at either end.
 */
export function PlanChoices({
  tiers,
  chosen,
  seats,
}: {
  tiers: MarketingTier[]
  chosen: string | null
  seats: number
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">Plan</legend>
      {tiers.map((tier) => {
        const price = tierPrice(tier)
        return (
          <label
            key={tier.key}
            className="group border-rule has-[:checked]:border-text has-[:checked]:bg-surface has-[:focus-visible]:ring-accent-fill flex cursor-pointer flex-col gap-2 rounded-xl border px-3.5 py-3 has-[:focus-visible]:ring-2"
          >
            <span className="flex items-start gap-3">
              <input
                type="radio"
                name="plan"
                value={tier.key}
                defaultChecked={tier.key === chosen}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="border-rule-strong peer-checked:border-text mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border"
              >
                <span className="bg-text hidden size-2 rounded-full group-has-[:checked]:block" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-text text-body font-medium">
                    {tier.name}
                  </span>
                  <span className="text-text-secondary font-mono text-caption whitespace-nowrap">
                    {price.amount}
                    {price.unit ? (
                      <span className="text-text-muted"> {price.unit}</span>
                    ) : null}
                  </span>
                </span>
                <span className="text-text-muted text-caption">
                  {tier.description}
                </span>
              </span>
            </span>
            {tier.key === 'team' ? (
              <span className="border-rule ml-7 hidden items-center justify-between gap-3 border-t pt-2 group-has-[:checked]:flex">
                <span className="text-text-secondary text-caption">
                  How many people?
                </span>
                <SeatStepper
                  min={tier.minSeats ?? 1}
                  max={tier.maxSeats}
                  initial={seats}
                />
              </span>
            ) : null}
          </label>
        )
      })}
    </fieldset>
  )
}
