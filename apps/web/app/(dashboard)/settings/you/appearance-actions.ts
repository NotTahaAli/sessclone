'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'

import { readSeed, SEED_REFUSALS, resolveAccent } from '../../../../lib/accent'
import {
  APPEARANCE_COOKIE,
  APPEARANCE_COOKIE_OPTIONS,
  encodeAppearance,
  setMemberAccent,
  setMemberTheme,
  viewerAppearance,
} from '../../../../lib/appearance'
import { asViewer } from '../../../../lib/db'
import { signedInUser } from '../../../../lib/supabase/server'

// Ticket 77's two Member writes. A Server Action is a POST endpoint anybody
// can reach whether or not the page rendered a form for them, so identity
// comes from the session and every input is parsed before it reaches a
// statement.
//
// Nothing here decides who may write. `members_write` plus the trigger in
// `20260922120000_appearance.sql` make appearance the Member's own — an Admin
// updating somebody else's row is refused by the database, not by this file —
// and the same trigger refuses a seed while the Org has locked its accent. A
// write that touched no rows is a refusal to report, and a raise is the lock.

export type AppearanceResult = { error: string } | { saved: string } | null

const Theme = z.enum(['light', 'dark', 'system'])

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

/**
 * Writes the cookie the inline script reads, from the appearance now in force.
 *
 * Re-read rather than assembled from what was just written: the answer depends
 * on the Org's lock and on whether the Member's own seed was cleared, and a
 * cookie that disagreed with the database would show somebody the colour they
 * did not save until the next sign-in.
 */
const remember = async (userId: string, memberId: string) => {
  const appearance = await asViewer(userId, (tx) =>
    viewerAppearance(tx, memberId),
  )
  const store = await cookies()
  store.set(
    APPEARANCE_COOKIE,
    encodeAppearance(appearance),
    APPEARANCE_COOKIE_OPTIONS,
  )
}

/**
 * Sets the Member's own accent seed, or clears it to inherit the Org's.
 *
 * The seed is resolved to its seven tones here, on the server, and stored
 * beside it — the ticket's third criterion. `@material/material-color-utilities`
 * is 60 kB of colour science, and a preview that resolved tones in the browser
 * would ship all of it to recompute what the database already holds.
 */
export const setOwnAccent = async (
  _previous: unknown,
  formData: FormData,
): Promise<AppearanceResult> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to change your appearance.' }

  const memberId = z.uuid().safeParse(formData.get('memberId'))
  if (!memberId.success) return { error: 'That is not a membership.' }

  // The empty field is "inherit", which is how somebody undoes a choice
  // without having to know what the Org's seed is.
  const typed = z
    .string()
    .max(9)
    .safeParse(submitted(formData) ?? '')
  if (!typed.success) return { error: SEED_REFUSALS.not_a_hex }

  const wanted = typed.data.trim()
  const read = wanted === '' ? null : readSeed(wanted)
  if (read && 'refusal' in read) return { error: SEED_REFUSALS[read.refusal] }

  try {
    const written = await asViewer(user.id, (tx) =>
      setMemberAccent(
        tx,
        memberId.data,
        read ? { seed: read.seed, tones: resolveAccent(read.seed) } : null,
      ),
    )
    if (!written) {
      return { error: 'That is not your membership to change.' }
    }
  } catch (error) {
    if (!isValueRefused(error)) throw error
    return {
      error:
        'Your Org has locked its accent colour, so the Org’s colour is the ' +
        'one in force.',
    }
  }

  await remember(user.id, memberId.data)
  // Not this page alone: the accent paints the shell and every page under it,
  // and the cookie is only read on a full load.
  revalidatePath('/', 'layout')
  return {
    saved: read
      ? `Your accent is now ${read.seed}.`
      : 'Your accent now follows your Org’s.',
  }
}

/** Sets light, dark or system. Never refused by the Org's lock: the mode is
 * always the Member's own (`docs/design/design-system.md` § Per Member). */
export const setOwnTheme = async (
  _previous: unknown,
  formData: FormData,
): Promise<AppearanceResult> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to change your appearance.' }

  const memberId = z.uuid().safeParse(formData.get('memberId'))
  const theme = Theme.safeParse(formData.get('theme'))
  if (!memberId.success || !theme.success) {
    return { error: 'That is not one of light, dark or system.' }
  }

  const written = await asViewer(user.id, (tx) =>
    setMemberTheme(tx, memberId.data, theme.data),
  )
  if (!written) return { error: 'That is not your membership to change.' }

  await remember(user.id, memberId.data)
  revalidatePath('/', 'layout')
  return {
    saved:
      theme.data === 'system'
        ? 'Light or dark now follows your device.'
        : `The ${theme.data} theme is now in force.`,
  }
}

/**
 * Whether the database refused the value itself.
 *
 * `P0001` is `raise_exception`, which the appearance guard and the lock both
 * raise; `23514` is `check_violation`, which the column's own constraint
 * raises for a seed that is not canonical hex. Everything else — a connection
 * that died, a statement timeout — belongs on an error page rather than behind
 * a sentence about a colour.
 */
const REFUSALS = new Set(['23514', 'P0001'])

const isValueRefused = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  REFUSALS.has(error.code)
