'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { revalidateCostPages } from '../../../../lib/cost-paths'

import {
  addOrgRate,
  deleteOrgRate,
  parseOrgRate,
} from '../../../../lib/org-rates'
import { asOperator, currentOperator } from '../../../../lib/platform-admin'

// Ticket 64's two writes. A Server Action is a POST endpoint whether or not a
// form was rendered for the caller, so every field is parsed (`parseOrgRate`)
// before it reaches a statement — and `org_rate_overrides_write` refuses a non-operator
// independently of the check here (ADR 0001).
//
// The operator may set any Org's rates. Since ticket 121 an Enterprise Org's
// Owner or Admin may set their own too (`settings/org/rates`): billing is per
// seat, so a rate changes an estimate and never an invoice.

export const addOrgRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { added: string } | null> => {
  if (!(await currentOperator())) {
    return {
      error: 'Only a platform administrator may set a negotiated price.',
    }
  }

  const parsed = parseOrgRate(formData)
  if (!parsed.success) {
    return { error: 'Check the model, the class, the price and the date.' }
  }

  try {
    await asOperator((tx) => addOrgRate(tx, parsed.data))
  } catch (error) {
    // `23505` read from the driver rather than from its English: a message
    // test matches any unique violation and changes with the server's locale.
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined
    return {
      error:
        code === '23505'
          ? 'This Org already has a negotiated price for that model and class from that date. Delete that row if you meant to change it.'
          : 'That price could not be saved.',
    }
  }

  // Not just this page: an override reprices every one of that Org's Turns on
  // the next read (ADR 0002), so every cost surface it has is now stale.
  revalidateCostPages()
  revalidatePath('/admin/orgs/[orgId]', 'page')
  return { added: parsed.data.model ?? 'the unnamed-model price' }
}

export const deleteOrgRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { deleted: true } | null> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may delete a price.' }
  }

  const parsed = z.object({ orgId: z.uuid(), rateId: z.uuid() }).safeParse({
    orgId: formData.get('orgId'),
    rateId: formData.get('rateId'),
  })
  if (!parsed.success) return { error: 'That price could not be found.' }

  // The boolean is the answer: the policy refuses a non-operator silently, so
  // a page that ignored it would report a deletion that never happened. The
  // Org is part of the statement because an id is not a capability.
  const deleted = await asOperator((tx) =>
    deleteOrgRate(tx, parsed.data.orgId, parsed.data.rateId),
  )
  if (!deleted) return { error: 'That price was not deleted.' }

  revalidateCostPages()
  revalidatePath('/admin/orgs/[orgId]', 'page')
  return { deleted: true }
}
