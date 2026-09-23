import { z } from 'zod'

import { SIGNUP_PLANS, type SignupPlan } from '../subscriptions'

// Ticket 118: the plan a sign-up asks for, carried from the sign-in form
// through GitHub or an inbox to the callback as two query parameters.
//
// Parsed at both ends, because both ends are trust boundaries — a form post
// and a query string. Anything unrecognised is no plan rather than an error:
// the sign-in still succeeds, and the Org waits for the operator either way.
// The Team size is bounded here loosely, and clamped to the Tier's own
// `min_seats` and `max_seats` when the caller has them; `subscriptions_request`
// is still the rule.

const Plan = z
  .object({
    plan: z.enum(SIGNUP_PLANS),
    seats: z.coerce.number().int().min(1).max(10_000).optional(),
  })
  .transform(({ plan, seats }): SignupPlan => ({
    tierKey: plan,
    // Personal is one person by definition; only Team asks for a size.
    // `subscriptions_request` wants the size stated either way.
    seats: plan === 'team' ? (seats ?? null) : 1,
  }))

type Source = { get: (name: string) => unknown }
type Bounds = { minSeats: number | null; maxSeats: number | null }

/**
 * The plan in a form or a query string, or null when there is none.
 *
 * With the Team Tier's bounds, a Team size is clamped into them: the GitHub
 * button skips the form's own `min`/`max`, and a size the Tier refuses would
 * otherwise leave the Org with no plan at all (`bootstrap.ts` swallows the
 * refusal).
 */
export const parsePlan = (source: Source, team?: Bounds): SignupPlan | null => {
  const seats = source.get('seats')
  const parsed = Plan.safeParse({
    plan: source.get('plan'),
    seats: seats === '' || seats === null ? undefined : seats,
  })
  if (!parsed.success) return null
  const plan = parsed.data
  if (!team || plan.tierKey !== 'team' || plan.seats === null) return plan
  return {
    ...plan,
    seats: Math.min(
      Math.max(plan.seats, team.minSeats ?? 1),
      team.maxSeats ?? Infinity,
    ),
  }
}

/** The same plan as query parameters, for the callback URL. */
export const planQuery = (plan: SignupPlan | null): string =>
  plan ? `plan=${plan.tierKey}${plan.seats ? `&seats=${plan.seats}` : ''}` : ''
