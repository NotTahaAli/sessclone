import { redirect } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'

import { approvalRequired } from '../../lib/approval'
import { signupStep } from '../../lib/auth/plan'
import { sessionUser } from '../../lib/supabase/server'
import type { MarketingTier } from '../../lib/tiers'
import { PanelCredit } from '../(dashboard)/credit'
import { LogoMark } from '../_ui/logo'
import { offeredPlans, PlanChoices } from '../sign-up/plan-choices'
import { NewOrgForm } from './new-org-form'

// Ticket 136: "New Org", from the Org switcher. Outside the dashboard's
// layout, which covers every page with the waiting page while the current
// Org waits for approval — and somebody in that Org may start another. The
// same one-column frame as `/sign-up`, whose plan step this reuses.
//
// Nothing here is read from an Org: the page needs only a session, and the
// action (`createOrg`) is what checks it.

async function Form() {
  if (!(await sessionUser())) redirect('/sign-in')

  // As sign-up: with approval off nobody confirms a plan, so none is asked.
  const approval = approvalRequired()
  if (!approval) return <Intro approval={false} />

  return <PlanStep tiers={await offeredPlans()} />
}

/** The form with its plan radios; with no Tier to offer (they could not be
 * read), a notice instead of a form every submit of which is refused. */
export function PlanStep({ tiers }: { tiers: MarketingTier[] }) {
  if (tiers.length === 0) {
    return (
      <p role="status" className="text-text-secondary mt-2 text-body">
        Plans cannot be loaded right now. Try again in a few minutes.
      </p>
    )
  }
  const step = signupStep(new URLSearchParams(), tiers)
  return (
    <Intro approval>
      {step.step === 'plan' ? (
        <PlanChoices tiers={tiers} chosen={step.chosen} seats={step.seats} />
      ) : null}
    </Intro>
  )
}

function Intro({
  approval,
  children = null,
}: {
  approval: boolean
  children?: ReactNode
}) {
  return (
    <>
      <p className="text-text-secondary mt-2 text-body">
        {approval
          ? 'You will be its Owner. It opens once it is approved, like a sign-up; your other Orgs carry on meanwhile.'
          : 'You will be its Owner, and it opens straight away.'}
      </p>
      <NewOrgForm plans={children} />
    </>
  )
}

export default function NewOrg() {
  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16">
      <LogoMark size={28} className="text-text mb-4" />
      <h1 className="text-heading-lg">New Org</h1>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
      <div className="mt-12">
        <PanelCredit />
      </div>
    </main>
  )
}
