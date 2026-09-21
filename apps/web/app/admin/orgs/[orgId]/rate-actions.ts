'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { addOrgRate, deleteOrgRate } from '../../../../lib/org-rates'
import { asOperator, currentOperator } from '../../../../lib/platform-admin'
import { RATE_CLASSES } from '../../../../lib/rates'

// Ticket 64's two writes. A Server Action is a POST endpoint whether or not a
// form was rendered for the caller, so every field is parsed before it reaches
// a statement — and `org_rate_overrides_write` refuses a non-operator
// independently of the check here (ADR 0001).
//
// Negotiated pricing is the operator's to set, never the Org's: an Owner who
// could write this table could halve their own invoice.

const Form = z.object({
  orgId: z.uuid(),
  // Empty is the override that does not name a model, such as a search.
  model: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null),
  class: z.enum(RATE_CLASSES),
  // Trimmed before the length check: '   ' has length 3 and `Number('   ')` is
  // 0, and a zero price is worse than no price — the Turn then reads as priced
  // at nothing rather than as unpriced (ADR 0002).
  priceUsd: z
    .string()
    .trim()
    // Digits and at most one point: a Server Action is a POST endpoint, and
    // `Number` alone accepts '0x10' as 16 and '1e5' as 100000.
    .regex(/^\d+(\.\d+)?$/, 'not a price')
    .transform(Number)
    .refine(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100_000,
      'not a price',
    ),
  // Bounded: a date in the 99th century is a typo, and it would sit at the
  // bottom of the list forever pricing nothing.
  effectiveFrom: z.iso.date().refine((value) => value <= '2100-01-01', 'too far ahead'),
  // What was agreed and where it is written down. An override with no
  // provenance is a discount nobody can re-check.
  note: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null),
})

export const addOrgRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { added: string } | null> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may set a negotiated price.' }
  }

  const parsed = Form.safeParse({
    orgId: formData.get('orgId'),
    model: formData.get('model') ?? '',
    class: formData.get('class'),
    priceUsd: formData.get('priceUsd'),
    effectiveFrom: formData.get('effectiveFrom'),
    note: formData.get('note') ?? '',
  })
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
  revalidatePath('/', 'layout')
  return { added: parsed.data.model ?? 'the unnamed-model price' }
}

export const deleteOrgRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { deleted: true } | null> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may delete a price.' }
  }

  const parsed = z
    .object({ orgId: z.uuid(), rateId: z.uuid() })
    .safeParse({
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

  revalidatePath('/', 'layout')
  return { deleted: true }
}
