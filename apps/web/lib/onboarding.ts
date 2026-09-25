import type postgres from 'postgres'

// Ticket 45: what the dashboard shows while the facts onboarding turns on are
// still false (`docs/design/product-ia.md`: onboarding "is not a modal over the
// dashboard and not a separate wizard route. It is what the dashboard shows
// while those facts are still false").
//
// Here rather than inside the page because both halves have been wrong once:
// the read asked only about the viewer's own Turns, and the branch asked about
// the key before the Turns. Neither is visible to a test while it is an inline
// query and a chain of `if`s inside a Server Component.

export type OnboardingFacts = {
  /** A live key this person holds. `api_keys_own` shows them no other. */
  has_key: boolean
  /** One of their keys has been used, whether or not a Turn came of it. */
  key_used: boolean
  /** A Turn in this Org that this person may see. */
  any_turns: boolean
}

/**
 * The three observed facts, in one round trip.
 *
 * Observed, never stored: there is no `onboarding_step` column and no
 * "completed setup" flag. That is what makes the flow resumable, survive
 * signing out halfway, and — the reason it matters — unable to lie, because a
 * flag says setup finished where observed state says a Turn arrived, and those
 * differ exactly when something has gone wrong.
 *
 * Each read is policy-scoped, so there is no `where` here deciding who may see
 * what (ADR 0001). The one `where` that is here is not about permission: the
 * policies scope to the *person*, and a person who is a Member of two Orgs
 * would otherwise see this Org reported as collecting on the strength of the
 * other Org's Turns.
 */
export const onboardingFacts = async (
  tx: postgres.TransactionSql,
  orgId: string,
) => {
  const [facts] = await tx<OnboardingFacts[]>`
    select
      exists (select 1 from api_keys where revoked_at is null) as has_key,
      exists (
        select 1 from api_keys
         where revoked_at is null and last_used_at is not null
      ) as key_used,
      -- However old: ticket 139's window hides Turns, not the fact of them.
      sessclone_org_has_turns(${orgId}) as any_turns
  `
  return facts!
}

/**
 * Which of the three states this surface is in.
 *
 * Turns first, and the order is the whole of it. `api_keys_own` shows a person
 * only their *own* keys, so an Owner whose four engineers are collecting holds
 * no key himself — and asked about the key first, he is told "you have no API
 * key yet" on an Org with a week of Turns in it. Collection working is the
 * stronger fact, so it answers first.
 */
export const onboardingState = (facts: OnboardingFacts) =>
  facts.any_turns ? 'collecting' : facts.has_key ? 'waiting' : 'no-key'
