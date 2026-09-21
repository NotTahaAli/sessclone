'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'

import { asOperator, currentOperator } from '../../../lib/platform-admin'
import { TIERS_TAG } from '../../../lib/tiers'
import { saveTier, type FeatureValue } from '../../../lib/tier-admin'

// Ticket 65's write. Every field is parsed before it reaches a statement, and
// `tiers_write` refuses it independently (ADR 0001).
//
// The prices are the load-bearing part: an empty price field is null, which
// with both of them empty means "contact us", and a `?? 0` anywhere on this
// path would quietly turn the Enterprise Tier into a free one.

/** An empty field is null, not zero and not an empty string. */
const optionalNumber = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value)))
  .refine(
    (value) => value === null || (Number.isFinite(value) && value >= 0),
    'not a number',
  )

const optionalInt = optionalNumber.refine(
  (value) => value === null || Number.isInteger(value),
  'not a whole number',
)

const Form = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'lowercase, digits and underscores'),
  name: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(400)
    .transform((value) => value || null),
  basePriceUsd: optionalNumber,
  seatPriceUsd: optionalNumber,
  includedSeats: z.coerce.number().int().min(0).max(100_000),
  minSeats: optionalInt,
  maxSeats: optionalInt,
  retentionMaxDays: optionalInt,
  archivalAvailable: z.literal(['on', null]).transform((v) => v === 'on'),
  available: z.literal(['on', null]).transform((v) => v === 'on'),
  sortOrder: z.coerce.number().int().min(0).max(1000),
  // Which form this came from. A create that collides with an existing key is
  // refused rather than silently replacing the definition every Org on that
  // Tier is entitled by.
  mode: z.enum(['create', 'edit']),
  features: z.string().trim().max(4000),
})

export const saveTierAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { saved: string } | null> => {
  if (!(await currentOperator())) {
    return { error: 'Only a platform administrator may define a Tier.' }
  }

  const parsed = Form.safeParse({
    key: formData.get('key'),
    name: formData.get('name'),
    description: formData.get('description') ?? '',
    basePriceUsd: formData.get('basePriceUsd') ?? '',
    seatPriceUsd: formData.get('seatPriceUsd') ?? '',
    includedSeats: formData.get('includedSeats') ?? 0,
    minSeats: formData.get('minSeats') ?? '',
    maxSeats: formData.get('maxSeats') ?? '',
    retentionMaxDays: formData.get('retentionMaxDays') ?? '',
    archivalAvailable: formData.get('archivalAvailable'),
    available: formData.get('available'),
    sortOrder: formData.get('sortOrder') ?? 0,
    features: formData.get('features') ?? '',
    mode: formData.get('mode') ?? 'create',
  })
  if (!parsed.success) {
    return { error: 'Check the key, the name, the prices and the seats.' }
  }

  const features = parseFeatures(parsed.data.features)
  if (features === null) {
    return { error: 'Features is a JSON object, or empty.' }
  }

  let saved: boolean
  try {
    saved = await asOperator((tx) => saveTier(tx, { ...parsed.data, features }))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    // The check constraints are the rules an operator can act on: a maximum
    // below a minimum, a negative price.
    return {
      error: /violates check constraint/i.test(message)
        ? 'Those numbers contradict each other — check seats and prices.'
        : 'That Tier could not be saved.',
    }
  }

  if (!saved) {
    return {
      error:
        parsed.data.mode === 'create'
          ? 'A Tier with that key already exists — edit it below.'
          : 'That Tier could not be saved.',
    }
  }

  // A Tier decides what every Org on it may do, and the public pricing pages
  // read the same rows: `updateTag` expires that cache now, so the next
  // request renders the price just typed rather than the one before it
  // (ticket 80). It is a Server Action, which is the only place `updateTag`
  // may be called — a route handler uses `revalidateTag` instead.
  updateTag(TIERS_TAG)
  revalidatePath('/', 'layout')
  return { saved: parsed.data.name }
}

/**
 * The `features` field, as an object of flat values — or null when it is not
 * one.
 *
 * Typed as JSON on purpose, because ADR 0004 makes the next gate a row rather
 * than a migration and there is no form control for a key nobody has invented
 * yet. Nested values are refused rather than stored: `features` is read by
 * comparing a key, so a shape nobody can compare is a shape nobody uses.
 */
const parseFeatures = (raw: string): Record<string, FeatureValue> | null => {
  if (raw === '') return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const features: Record<string, FeatureValue> = {}
  for (const [gate, value] of Object.entries(parsed)) {
    if (
      value !== null &&
      typeof value !== 'boolean' &&
      typeof value !== 'number' &&
      typeof value !== 'string'
    ) {
      return null
    }
    features[gate] = value
  }
  return features
}
