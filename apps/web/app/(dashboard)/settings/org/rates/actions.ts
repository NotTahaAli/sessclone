'use server'

import { z } from 'zod'

import { revalidateCostPages } from '../../../../../lib/cost-paths'
import { asViewer } from '../../../../../lib/db'
import {
  addOrgRate,
  deleteOrgRate,
  parseOrgRate,
} from '../../../../../lib/org-rates'
import { reachesOrgSettings, viewerOfOrg } from '../../../../../lib/viewer'

// Ticket 121: an Enterprise Org's Owner or Admin sets its own rates.
//
// The same two writes as the admin page's, gated on the Org instead of the
// platform flag. The check here is the courtesy — a clear sentence rather
// than a silent refusal — and `org_rate_overrides_own` is the rule: Owner or
// Admin, of this Org, on a Tier with `features.own_rates`. The Org in the
// form must be the viewer's own; anything else is refused before a statement.

/** The viewer's Org, when they may manage its settings and it is the one the
 * form names. */
const ownOrg = async (orgId: unknown) => {
  const viewer = await viewerOfOrg(orgId)
  return viewer && reachesOrgSettings(viewer.role) ? viewer : null
}

export const addOwnRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { added: string } | null> => {
  const viewer = await ownOrg(formData.get('orgId'))
  if (!viewer) {
    return { error: 'Only an Owner or Admin may set this Org’s rates.' }
  }

  const parsed = parseOrgRate(formData)
  if (!parsed.success) {
    return { error: 'Check the model, the class, the price and the date.' }
  }

  try {
    await asViewer(viewer.userId, (tx) => addOrgRate(tx, parsed.data))
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined
    return {
      error:
        code === '23505'
          ? 'There is already a rate for that model and class from that date. Delete it if you meant to change it.'
          : code === '42501'
            ? 'Your plan does not include setting your own rates.'
            : 'That rate could not be saved.',
    }
  }

  // Every cost surface reprices on the next read (ADR 0002).
  revalidateCostPages()
  return { added: parsed.data.model ?? 'the unnamed-model rate' }
}

export const deleteOwnRateAction = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { deleted: true } | null> => {
  const viewer = await ownOrg(formData.get('orgId'))
  if (!viewer) {
    return { error: 'Only an Owner or Admin may delete this Org’s rates.' }
  }

  const rateId = z.uuid().safeParse(formData.get('rateId'))
  if (!rateId.success) return { error: 'That rate could not be found.' }

  // The policy refuses silently on a delete, so the boolean is the answer.
  const deleted = await asViewer(viewer.userId, (tx) =>
    deleteOrgRate(tx, viewer.orgId, rateId.data),
  )
  if (!deleted) return { error: 'That rate was not deleted.' }

  revalidateCostPages()
  return { deleted: true }
}
