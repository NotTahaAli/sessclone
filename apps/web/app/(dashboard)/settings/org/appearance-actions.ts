'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { readSeed, SEED_REFUSALS, resolveAccent } from '../../../../lib/accent'
import { setOrgAccent, setOrgAccentLock } from '../../../../lib/appearance'
import { asViewer } from '../../../../lib/db'
import { viewerOfOrg } from '../../../../lib/viewer'

// Ticket 77's two Org writes: the default accent seed, and whether Members may
// override it. Owner or Admin, which is `orgs_write` — this file asserts
// nothing about Roles, and a refusal arrives as a write that touched no rows.
//
// No cookie is written here, for a reason worth stating: this changes what
// *everybody* in the Org sees, and their cookies are on their own browsers.
// `AppearanceSync` in the dashboard shell notices the disagreement on each
// Member's next full load and corrects it there; the Owner who saved sees it
// at once, through the shell's re-render and `AppearanceLive`.

export type OrgAppearanceResult = { error: string } | { saved: string } | null

/**
 * What the picker submitted: a swatch's own value when one was clicked,
 * otherwise the hex field.
 *
 * Two names rather than one, because a submit button carries its own entry and
 * FormData reads entries in DOM order — one shared name would mean the "follow
 * the Org's colour" button, which sits below the field, submitted whatever was
 * typed instead of clearing. `seed` present and empty is therefore a real
 * answer and not a missing one.
 */
const submitted = (formData: FormData) =>
  formData.has('seed') ? formData.get('seed') : formData.get('typed')

export const setOrgSeed = async (
  _previous: unknown,
  formData: FormData,
): Promise<OrgAppearanceResult> => {
  const viewer = await viewerOfOrg(formData.get('orgId'))
  if (!viewer) return { error: 'Sign in again to change the Org’s colour.' }

  const orgId = z.uuid().safeParse(formData.get('orgId'))
  const typed = z.string().min(1).max(9).safeParse(submitted(formData))
  if (!orgId.success || !typed.success) {
    return { error: SEED_REFUSALS.not_a_hex }
  }

  const read = readSeed(typed.data)
  if ('refusal' in read) return { error: SEED_REFUSALS[read.refusal] }

  const written = await asViewer(viewer.userId, (tx) =>
    setOrgAccent(tx, orgId.data, {
      seed: read.seed,
      tones: resolveAccent(read.seed),
    }),
  )
  if (!written) {
    return { error: 'You do not have permission to change this setting.' }
  }

  revalidatePath('/', 'layout')
  return { saved: `The Org’s accent is now ${read.seed}.` }
}

export const setSeedLock = async (
  _previous: unknown,
  formData: FormData,
): Promise<OrgAppearanceResult> => {
  const viewer = await viewerOfOrg(formData.get('orgId'))
  if (!viewer) return { error: 'Sign in again to change the Org’s colour.' }

  const orgId = z.uuid().safeParse(formData.get('orgId'))
  const locked = z.enum(['on', 'off']).safeParse(formData.get('locked'))
  if (!orgId.success || !locked.success) {
    return { error: 'That is not a setting.' }
  }

  const written = await asViewer(viewer.userId, (tx) =>
    setOrgAccentLock(tx, orgId.data, locked.data === 'on'),
  )
  if (!written) {
    return { error: 'You do not have permission to change this setting.' }
  }

  revalidatePath('/', 'layout')
  return {
    saved:
      locked.data === 'on'
        ? 'The Org’s accent is now locked. A Member’s own colour is kept but not applied, so unlocking gives everybody their choice back.'
        : 'Members may choose their own accent again.',
  }
}
