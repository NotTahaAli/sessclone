'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asOperator, currentOperator } from '../../../../lib/platform-admin'
import { setSubscription } from '../../../../lib/subscriptions'
import { NAME_LIMIT, setOrgOperatorName } from '../../../../lib/names'
import type { NameState } from '../../../(dashboard)/inline-name'

// Ticket 48's one write. A Server Action is a POST endpoint whether or not a
// form was rendered for the caller, so every field is parsed before it reaches
// a statement, and `subscriptions_write` refuses it independently of this
// check (ADR 0001).

const Form = z.object({
  orgId: z.uuid(),
  tierId: z.uuid(),
  status: z.enum(['inactive', 'active', 'past_due', 'cancelled']),
  // The one part of the event the database cannot know. Optional, because an
  // operator who gives no reason should still leave a record that they acted.
  note: z
    .string()
    .trim()
    .max(500)
    .transform((value) => value || null),
})

export const activateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { saved: 'recorded' | 'unchanged' } | null> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may activate an Org.' }
  }

  const parsed = Form.safeParse({
    orgId: formData.get('orgId'),
    tierId: formData.get('tierId'),
    status: formData.get('status'),
    note: formData.get('note') ?? '',
  })
  if (!parsed.success) return { error: 'Pick a Tier and a status.' }

  const { orgId, ...subscription } = parsed.data
  let result
  try {
    result = await asOperator((tx) =>
      setSubscription(tx, { orgId, ...subscription }),
    )
  } catch {
    return { error: 'That subscription could not be saved.' }
  }

  // `subscriptions_write` refuses a caller who is not a Platform Admin by
  // writing nothing, so a page that assumed success would report an
  // activation that did not happen.
  if (!result.saved) {
    return { error: 'That subscription could not be saved.' }
  }

  // Not just this page: status decides what the Org's own dashboard says on
  // every page of it.
  revalidatePath('/', 'layout')
  // An event lands only when the Tier or the status changed, so a note typed
  // beside an unchanged subscription is not written down — and the form says
  // that rather than pointing at a history it did not add to.
  return { saved: result.recorded ? 'recorded' : 'unchanged' }
}

/**
 * Ticket 102: what platform administrators call this Org, never shown to it.
 *
 * `org_operator_names_admin` refuses anybody else independently of the check
 * below. An empty box clears the name, and the Org's own name shows again.
 */
export const setOperatorName = async (
  _previous: NameState,
  formData: FormData,
): Promise<NameState> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may name an Org here.' }
  }

  const orgId = z.uuid().safeParse(formData.get('orgId'))
  const name = z.string().trim().max(NAME_LIMIT).safeParse(formData.get('name'))
  if (!orgId.success) return { error: 'That request was missing the Org.' }
  if (!name.success) {
    return { error: `A name is ${NAME_LIMIT} characters or fewer.` }
  }

  const value = name.data === '' ? null : name.data
  try {
    await asOperator((tx) => setOrgOperatorName(tx, orgId.data, value))
  } catch {
    return { error: 'That name could not be saved.' }
  }

  revalidatePath('/admin/orgs')
  revalidatePath(`/admin/orgs/${orgId.data}`)
  return { saved: value }
}
