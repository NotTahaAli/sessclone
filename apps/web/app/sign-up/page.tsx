import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { approvalRequired } from '../../lib/approval'
import { planQuery, signupStep } from '../../lib/auth/plan'
import { peopleLabel, priceFor } from '../../lib/plans'
import type { SignupPlan } from '../../lib/subscriptions'
import type { MarketingTier } from '../../lib/tiers'
import { PanelCredit } from '../(dashboard)/credit'
import { LogoMark } from '../_ui/logo'
import { buttonClass, inputClass } from '../_ui/primitives'
import { sendMagicLink, signInWithGitHub } from '../sign-in/actions'
import { Notices } from '../sign-in/notices'
import { ProviderError } from '../sign-in/provider-error'
import { offeredPlans, PlanChoices } from './plan-choices'

// Joining the waitlist, split from `/sign-in` (Taha, 2026-09-24, layout A):
// sign-in only signs in, and this page asks for the plan first and the account
// second (layout S2), so the plan plainly applies to both ways of signing up.
// The pricing page links straight to the second step with its plan and team
// size, since the visitor chose there already (`signupStep`).
//
// Same one-column frame as `/sign-in`, and the query string streams in behind
// a Suspense boundary so the frame prerenders (ticket 83).

type Query = Promise<Record<string, string | string[] | undefined>>

const PRIMARY = `${buttonClass('primary')} w-full`
const SECONDARY = `${buttonClass()} w-full`
const STEP = 'text-text-muted font-mono text-caption'
const LINK = 'text-text underline underline-offset-2 hover:text-accent-text'

const toParams = (query: Awaited<Query>) =>
  new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      typeof value === 'string' ? [[key, value]] : [],
    ),
  )

async function Steps({ searchParams }: { searchParams: Query }) {
  // With approval off nobody confirms a plan: signing in is signing up.
  if (!approvalRequired()) redirect('/sign-in')

  const tiers = await offeredPlans()
  const step = signupStep(toParams(await searchParams), tiers)

  if (step.step === 'account') {
    const tier = tiers.find((t) => t.key === step.plan.tierKey)!
    return <Account tier={tier} plan={step.plan} searchParams={searchParams} />
  }
  return <ChoosePlan tiers={tiers} chosen={step.chosen} seats={step.seats} />
}

function ChoosePlan({
  tiers,
  chosen,
  seats,
}: {
  tiers: MarketingTier[]
  chosen: string | null
  seats: number
}) {
  return (
    <>
      <p className={STEP}>Step 1 of 2</p>
      <h1 className="text-heading-lg mt-1">Choose a plan</h1>
      <p className="text-text-secondary mt-2 text-body">
        Your organisation opens once it is approved. Nothing is charged until
        billing exists.
      </p>

      {/* A GET back to this page: the choice lands in the query string, which
          is what the account step and the pricing page's link both read. */}
      <form action="/sign-up" className="mt-6 flex flex-col gap-2">
        <PlanChoices tiers={tiers} chosen={chosen} seats={seats} />
        <button type="submit" className={`${PRIMARY} mt-4`}>
          Continue
        </button>
      </form>
    </>
  )
}

function Account({
  tier,
  plan,
  searchParams,
}: {
  tier: MarketingTier
  plan: SignupPlan
  searchParams: Query
}) {
  const seats = plan.seats ?? 1
  const price = priceFor(tier, seats)
  return (
    <>
      <p className={STEP}>Step 2 of 2</p>
      <h1 className="text-heading-lg mt-1">Create your account</h1>

      <div className="bg-surface border-rule mt-6 flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-text text-body font-medium">
            {tier.name}
            {tier.key === 'team' ? ` · ${peopleLabel(seats)}` : null}
          </span>
          <span className="text-text-muted text-caption">
            {price.amount === 'Free' || price.amount === 'Talk to us'
              ? price.amount
              : `${price.amount}/month once billing opens`}
          </span>
        </span>
        <Link
          href={`/sign-up?${planQuery(plan)}&edit=1`}
          className={`${LINK} text-caption`}
        >
          Change
        </Link>
      </div>

      <Notices
        searchParams={searchParams}
        sentMessage="Check your inbox: a sign-up link is on its way. It works once and expires."
      />
      <ProviderError />

      {/* One form, two ways to submit it, and the plan rides with both. */}
      <form action={sendMagicLink} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="from" value="sign-up" />
        <input type="hidden" name="plan" value={plan.tierKey} />
        <input type="hidden" name="seats" value={seats} />

        <button
          type="submit"
          formAction={signInWithGitHub}
          formNoValidate
          className={PRIMARY}
        >
          Continue with GitHub
        </button>

        <div className="text-text-muted flex items-center gap-3 text-caption">
          <span className="border-rule flex-1 border-t" />
          or
          <span className="border-rule flex-1 border-t" />
        </div>

        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className={`${inputClass} w-full`}
        />
        <button type="submit" className={SECONDARY}>
          Email me a sign-up link
        </button>
      </form>

      <p className="text-text-muted mt-4 text-caption">
        No password to set or forget.
      </p>
    </>
  )
}

export default function SignUp({ searchParams }: { searchParams: Query }) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16">
      <LogoMark size={28} className="text-text mb-4" />

      <Suspense fallback={null}>
        <Steps searchParams={searchParams} />
      </Suspense>

      <p className="text-text-muted mt-6 text-caption">
        Already have an account?{' '}
        <Link href="/sign-in" className={LINK}>
          Sign in
        </Link>
      </p>

      <div className="mt-12">
        <PanelCredit />
      </div>
    </main>
  )
}
