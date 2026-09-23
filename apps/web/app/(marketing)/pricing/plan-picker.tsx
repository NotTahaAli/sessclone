'use client'

import Link from 'next/link'
import { useCallback, useState, type ChangeEvent, type ReactNode } from 'react'

import { REPOSITORY } from '../constants'
import {
  MAX_TEAM,
  peopleLabel,
  priceFor,
  recommendedTier,
  shortPrice,
  unfitReason,
} from '../../../lib/plans'
import { contactEmail } from '../../../lib/site'
import type { TierPricing } from '../../../lib/tiers'
import { buttonClass, SectionBreak } from '../../_ui/primitives'

// The slider and everything that follows it (ticket 115). A client module for
// the one piece of state, the team size; the page reads the Tiers and hands
// them in as plain data. No effect and no listener of ours: the range input's
// own `onChange` is the only wiring.

/** One plan as the page hands it over: the Tier's pricing columns and the
 * lines it lists, already read from the row. */
export type Plan = TierPricing & {
  includedSeats: number
  key: string
  name: string
  description: string
  lines: string[]
}

/** The team size a visitor lands on (Taha, 2026-09-23). */
const DEFAULT_TEAM = 3

export function PlanPicker({
  plans,
  rows,
  children,
}: {
  plans: Plan[]
  /** The comparison, one cell per plan in `plans` order. */
  rows: { label: string; cells: (string | boolean)[] }[]
  /** The heading and lede above the slider. */
  children: ReactNode
}) {
  const [team, setTeam] = useState(DEFAULT_TEAM)
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setTeam(Number(event.target.value)),
    [],
  )
  const pick = recommendedTier(plans, team)

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-14">
        <div>
          {children}
          <label
            htmlFor="team-size"
            className="flex items-baseline justify-between"
          >
            <span className="text-text-muted text-label uppercase">
              Team size
            </span>
            <output
              htmlFor="team-size"
              className="font-mono text-[22px] font-medium"
            >
              {peopleLabel(team)}
            </output>
          </label>
          <input
            id="team-size"
            type="range"
            min={1}
            max={MAX_TEAM}
            value={team}
            onChange={onChange}
            aria-valuetext={peopleLabel(team)}
            className="accent-text mt-2.5 rounded-full mb-0.5 h-6 w-full cursor-pointer"
          />
          {/* 10 sits where 10 is on a 1-to-25 track, not halfway. */}
          <div
            aria-hidden="true"
            className="text-text-muted relative h-4 font-mono text-[11px]"
          >
            <span className="absolute left-0">1</span>
            <span className="absolute left-[37.5%] -translate-x-1/2">10</span>
            <span className="absolute right-0">{MAX_TEAM}+</span>
          </div>
        </div>

        <ul aria-label="Plans" className="lg:pt-1">
          {plans.map((plan) => (
            <PlanRow
              key={plan.key}
              plan={plan}
              team={team}
              picked={plan.key === pick}
            />
          ))}
        </ul>
      </div>

      <SectionBreak>Compare every plan</SectionBreak>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] table-fixed border-collapse text-[13px]">
          <thead>
            <tr className="border-rule border-b">
              <td className="w-[22%]" />
              {plans.map((plan) => (
                <th
                  key={plan.key}
                  scope="col"
                  className={`px-2 py-2.5 font-semibold ${plan.key === pick ? 'bg-selected' : ''}`}
                >
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-rule border-b">
                <th
                  scope="row"
                  className="text-text-muted px-2 py-2.5 text-left font-normal"
                >
                  {row.label}
                </th>
                {row.cells.map((cell, index) => (
                  <td
                    // oxlint-disable-next-line no-array-index-key -- cells are positional, one per plan
                    key={index}
                    className={`px-2 py-2.5 text-center ${plans[index]?.key === pick ? 'bg-selected' : ''}`}
                  >
                    <Cell value={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** A yes or a no as a glyph with its word for assistive tech; text as is. */
function Cell({ value }: { value: string | boolean }) {
  if (typeof value === 'string') return value
  return value ? (
    <span className="text-ok-text">
      ✓<span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="text-text-muted">
      —<span className="sr-only">Not included</span>
    </span>
  )
}

function PlanRow({
  plan,
  team,
  picked,
}: {
  plan: Plan
  team: number
  picked: boolean
}) {
  const why = unfitReason(plan, team)
  // A plan that does not fit shows its rate, not a total for a team it
  // cannot hold.
  const price = why
    ? { amount: shortPrice(plan), per: why }
    : priceFor(plan, team)
  const contact = plan.basePriceUsd === null && plan.seatPriceUsd === null
  const email = contactEmail()

  return (
    <li
      className={
        picked
          ? 'bg-surface border-rule my-1 rounded-xl border px-3.5 py-3'
          : `border-rule border-t py-3 first:border-t-0 [li.bg-surface+&]:border-t-0 ${why ? 'opacity-45' : ''}`
      }
    >
      <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-2.5 gap-y-0.5">
        <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          {plan.name}
          {picked ? (
            <span className="border-accent-border text-accent-text rounded-full border px-[7px] py-0.5 text-[10.5px] font-medium tracking-[0.06em] whitespace-nowrap uppercase">
              Fits {peopleLabel(team)}
            </span>
          ) : null}
        </span>
        <span className="text-right font-mono text-[15px]">{price.amount}</span>
        <span className="text-text-muted text-caption">{plan.description}</span>
        <span className="text-text-muted text-right font-mono text-caption">
          {price.per}
        </span>
      </div>
      {why ? null : (
        <ul className="mt-2 grid gap-[3px] text-[13px]">
          {plan.lines.map((line) => (
            <li key={line} className="grid grid-cols-[16px_1fr] gap-1">
              <span aria-hidden="true" className="text-ok-text">
                ✓
              </span>
              {line}
            </li>
          ))}
        </ul>
      )}
      {picked ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {contact ? (
            // With no contact address there is nobody to talk to: no CTA,
            // rather than a link to somebody else's inbox or issue tracker.
            email ? (
              <a
                href={`mailto:${email}?subject=SessClone%20${encodeURIComponent(plan.name)}`}
                className={buttonClass('primary')}
              >
                Talk to us
              </a>
            ) : null
          ) : (
            // Until billing exists, sign-up is the waitlist: it records the
            // plan as an inactive subscription for the operator to approve.
            <Link
              href={`/sign-in?plan=${encodeURIComponent(plan.key)}`}
              className={buttonClass('primary')}
            >
              Join waitlist
            </Link>
          )}
          <a href={REPOSITORY} className={buttonClass()}>
            Self-host instead
          </a>
        </div>
      ) : null}
    </li>
  )
}
