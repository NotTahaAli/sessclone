'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asOperator, currentOperator } from '../../../../lib/platform-admin'
import { setSubscription } from '../../../../lib/subscriptions'

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
): Promise<{ error: string } | { saved: true } | null> => {
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
  try {
    await asOperator((tx) => setSubscription(tx, { orgId, ...subscription }))
  } catch {
    return { error: 'That subscription could not be saved.' }
  }

  // Not just this page: status decides what the Org's own dashboard says on
  // every page of it.
  revalidatePath('/', 'layout')
  return { saved: true }
}
