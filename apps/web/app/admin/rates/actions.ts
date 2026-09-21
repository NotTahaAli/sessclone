'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asOperator, currentOperator } from '../../../lib/platform-admin'
import { addRate, deleteRate, RATE_CLASSES } from '../../../lib/rates'

// The one write on this page. A Server Action is a POST endpoint whether or
// not a form was rendered for the caller, so every field is parsed here and
// `rates_write` refuses the statement independently (ADR 0001) — the check
// below only turns that refusal into a sentence.

const Form = z.object({
  // Empty is the rate that does not name a model, such as a web search.
  model: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null),
  class: z.enum(RATE_CLASSES),
  // A price, not a number: 20 digits of float noise in a money column is a
  // bug that only shows up on an invoice.
  priceUsd: z.coerce.number().nonnegative().max(100_000),
  effectiveFrom: z.iso.date(),
  source: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null),
})

export const addRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { added: string } | null> => {
  const operator = await currentOperator()
  if (!operator) {
    return { error: 'Only a platform administrator may publish a price.' }
  }

  const parsed = Form.safeParse({
    model: formData.get('model') ?? '',
    class: formData.get('class'),
    priceUsd: formData.get('priceUsd'),
    effectiveFrom: formData.get('effectiveFrom'),
    source: formData.get('source') ?? '',
  })
  if (!parsed.success) {
    return { error: 'Check the model, the class, the price and the date.' }
  }

  try {
    await asOperator((tx) => addRate(tx, parsed.data))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // The one refusal the operator can act on: this model, class and date
    // already has a price. Never an overwrite — that would rewrite what an
    // already-collected Turn cost.
    return {
      error: /duplicate key|unique/i.test(message)
        ? 'That model and class already has a price from that date. Delete that row if you meant to change it.'
        : 'That price could not be published.',
    }
  }

  // Not just this page: a new Rate reprices every Org's waiting Turns on the
  // next read (ADR 0002), so every cost surface is now stale.
  revalidatePath('/', 'layout')
  return { added: parsed.data.model ?? 'the unnamed-model rate' }
}

/**
 * Removes a published price.
 *
 * The only correction there is, because a Rate is never edited: the row that
 * priced a Turn either exists or does not, and every Turn that resolved to it
 * reprices on the next read.
 */
export const deleteRateAction = async (formData: FormData) => {
  if (!(await currentOperator())) return

  const id = z.uuid().safeParse(formData.get('rateId'))
  if (!id.success) return

  await asOperator((tx) => deleteRate(tx, id.data))
  revalidatePath('/', 'layout')
}
