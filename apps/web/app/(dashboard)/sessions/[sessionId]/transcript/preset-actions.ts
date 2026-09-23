'use server'

import { z } from 'zod'

import { CATEGORIES } from '@sessclone/shared'
import { asViewer } from '../../../../../lib/db'
import { signedInUser } from '../../../../../lib/supabase/server'
import * as presets from '../../../../../lib/view-presets'

// Tickets 102-104: the transcript viewer's saved presets. Anybody can POST to
// a Server Action, so every input is parsed here, and whose row it is comes
// from the verified session, never from the arguments.

const Name = z.string().trim().min(1).max(60)
const Preset = z.object({
  name: Name,
  categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length),
  thinking: z.enum(['hidden', 'collapsed', 'verbose']),
})
const Id = z.uuid()

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const SIGN_IN = { ok: false, error: 'Sign in again.' } as const

export const listPresets = async (): Promise<Result<presets.SavedPreset[]>> => {
  const user = await signedInUser()
  if (!user) return SIGN_IN
  return { ok: true, value: await asViewer(user.id, presets.listPresets) }
}

export const savePreset = async (
  input: z.input<typeof Preset>,
): Promise<Result<presets.SavedPreset>> => {
  const user = await signedInUser()
  if (!user) return SIGN_IN
  const parsed = Preset.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'That is not a preset.' }
  const preset = {
    ...parsed.data,
    categories: [...new Set(parsed.data.categories)],
  }
  return {
    ok: true,
    value: await asViewer(user.id, (tx) => presets.savePreset(tx, preset)),
  }
}

export const deletePreset = async (id: string): Promise<Result<null>> => {
  const user = await signedInUser()
  if (!user) return SIGN_IN
  const parsed = Id.safeParse(id)
  const deleted =
    parsed.success &&
    (await asViewer(user.id, (tx) => presets.deletePreset(tx, parsed.data)))
  return deleted
    ? { ok: true, value: null }
    : { ok: false, error: 'No such preset.' }
}

export const setDefaultPreset = async (
  id: string | null,
): Promise<Result<null>> => {
  const user = await signedInUser()
  if (!user) return SIGN_IN
  const parsed = Id.nullable().safeParse(id)
  if (!parsed.success) return { ok: false, error: 'No such preset.' }
  // A refused id rolls back the cleared default too, so nothing half-changes.
  const done = await asViewer(user.id, async (tx) => {
    if (await presets.setDefaultPreset(tx, parsed.data)) return true
    throw new Error('not yours')
  }).catch(() => false)
  return done
    ? { ok: true, value: null }
    : { ok: false, error: 'No such preset.' }
}
