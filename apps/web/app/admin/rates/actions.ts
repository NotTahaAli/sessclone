'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asOperator, currentOperator } from '../../../lib/platform-admin'
import { addRate, deleteRate, RATE_CLASSES } from '../../../lib/rates'
import {
  applyProposals,
  fetchPublished,
  pendingProposals,
  type Proposal,
} from '../../../lib/rate-sync'

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
  // A price, and never an absent one: `z.coerce.number()` turns both null and
  // '' into 0, and a zero price is worse than no price — the Turn then reads
  // as priced at nothing rather than as unpriced, and understates every
  // invoice that touches the model (ADR 0002).
  // `.trim()` before `.min(1)`: '   ' has length 3, and `Number('   ')` is 0,
  // so an untrimmed guard admits a whitespace price as $0.00.
  priceUsd: z
    .string()
    .trim()
    .min(1)
    .transform(Number)
    .refine(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100_000,
      'not a price',
    ),
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
    // `23505` is the unique violation, read from the driver's error rather
    // than from its English: a message test matches any unique violation and
    // changes with the server's locale.
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined
    // The one refusal the operator can act on: this model, class and date
    // already has a price. Never an overwrite — that would rewrite what an
    // already-collected Turn cost.
    return {
      error:
        code === '23505'
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
export const deleteRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { deleted: true } | null> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may delete a price.' }
  }

  const id = z.uuid().safeParse(formData.get('rateId'))
  if (!id.success) return { error: 'That price could not be found.' }

  // The boolean is the answer: `rates_write` refuses a non-operator silently,
  // so a page that ignored it would report a deletion that never happened.
  const deleted = await asOperator((tx) => deleteRate(tx, id.data))
  if (!deleted) return { error: 'That price was not deleted.' }

  revalidatePath('/', 'layout')
  return { deleted: true }
}

// Ticket 97: the published price list, fetched and offered for approval.
//
// Two steps behind one Server Action, so the page holds one state: `fetch`
// reads the page and proposes; `apply` reads it again and publishes only the models the operator ticked. The
// browser posts model ids, never prices, so a forged request can at most
// accept a change the page itself published.

export type SyncState =
  | { error: string }
  | { proposals: Proposal[] }
  | { applied: number; models: string[] }
  | null

const syncToday = () => new Date().toISOString().slice(0, 10)

const readProposals = async () => {
  const published = await fetchPublished()
  return asOperator((tx) => pendingProposals(tx, published, syncToday()))
}

const fetchPricing = async (): Promise<SyncState> => {
  try {
    return { proposals: await readProposals() }
  } catch {
    return { error: 'The published pricing page could not be read.' }
  }
}

const Approved = z.array(z.string().trim().min(1).max(200)).min(1).max(200)

export const syncPricingAction = async (
  _previous: SyncState,
  formData: FormData,
): Promise<SyncState> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may sync pricing.' }
  }
  return formData.get('intent') === 'apply'
    ? applyPricing(formData)
    : fetchPricing()
}

const applyPricing = async (formData: FormData): Promise<SyncState> => {
  const approved = Approved.safeParse(formData.getAll('model'))
  if (!approved.success) return { error: 'Tick at least one model to apply.' }

  const chosen = new Set(approved.data)
  try {
    const published = await fetchPublished()
    const today = syncToday()
    const applied = await asOperator(async (tx) => {
      const proposals = (await pendingProposals(tx, published, today)).filter(
        (proposal) => chosen.has(proposal.model),
      )
      return {
        count: await applyProposals(tx, proposals, today),
        models: proposals.map((proposal) => proposal.model),
      }
    })
    revalidatePath('/', 'layout')
    return { applied: applied.count, models: applied.models }
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined
    return {
      error:
        code === '23505'
          ? 'A ticked model already has a price from today. Delete that row first; nothing was applied.'
          : 'Nothing was applied: the pricing page could not be read or a price was refused.',
    }
  }
}
