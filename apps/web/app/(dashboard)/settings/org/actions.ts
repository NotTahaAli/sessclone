'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { asViewer } from '../../../../lib/db'
import { setOrgRetention, setOrgTimezone } from '../../../../lib/org'
import { signedInUser } from '../../../../lib/supabase/server'

// Ticket 51's timezone write and ticket 61's retention write. A Server Action is a POST endpoint anybody can reach,
// whether or not the page rendered a form for them, so identity comes from the
// session and every input is parsed before it reaches a statement — the same
// treatment the Keys and Your-settings actions give theirs.
//
// Nothing here decides who may write: `orgs_write` is Owner or Admin, and the
// trigger beside the column refuses a name the timezone database does not
// know. The action runs on the viewer's connection, so both apply, and a
// refusal is a write that touched no rows rather than an error to render.

// A zone name, bounded and shaped before it reaches the statement. The real
// check is the trigger's — this is the trust boundary doing its own job, not
// a second copy of the timezone database.
const Timezone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+_-]+)*$/)

export const setTimezone = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { saved: string } | null> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to change the timezone.' }

  const timezone = Timezone.safeParse(formData.get('timezone'))
  const orgId = z.uuid().safeParse(formData.get('orgId'))
  if (!timezone.success || !orgId.success) {
    return { error: 'That is not a timezone this deployment knows.' }
  }

  try {
    const written = await asViewer(user.id, (tx) =>
      setOrgTimezone(tx, orgId.data, timezone.data),
    )
    // A write refused by `orgs_write` touches no rows and raises nothing, so
    // without this a Manager posting the form gets a page that looks like it
    // saved. Told apart from the raise below because they need different
    // sentences: one is "you may not", the other is "that name is not one".
    if (!written) {
      return { error: 'You do not have permission to change this setting.' }
    }
  } catch (error) {
    // The trigger refuses a name the timezone database does not know, and one
    // that is a fixed offset wearing a name. Either way the Owner needs the
    // sentence rather than an error page — and anything that is not the
    // trigger is not this sentence, so it is rethrown.
    if (!isValueRefused(error)) throw error
    return { error: 'That is not a timezone this deployment knows.' }
  }

  // Not just this page: `viewer.orgTimezone` is read by the shell and by every
  // surface that cuts Turns into days, and those live on other routes. A
  // revalidation of this path alone would leave the charts on the old zone
  // until something else happened to evict them.
  revalidatePath('/', 'layout')
  return { saved: timezone.data }
}

/** The window, bounded before it reaches a statement. The Tier's ceiling is
 * the trigger's to enforce; this is the trust boundary refusing nonsense. */
const Days = z.coerce.number().int().min(1).max(3650)

/**
 * Sets how long this Org keeps a stored transcript (ticket 61).
 *
 * Shortening it does not delete anything by itself: the sweep
 * (`POST /api/retention/sweep`) is what removes what is now past the window,
 * and the message says so rather than implying an immediate deletion that has
 * not happened.
 */
export const setRetention = async (
  _previous: unknown,
  formData: FormData,
): Promise<{ error: string } | { saved: number } | null> => {
  const user = await signedInUser()
  if (!user) return { error: 'Sign in again to change retention.' }

  const days = Days.safeParse(formData.get('days'))
  const orgId = z.uuid().safeParse(formData.get('orgId'))
  if (!days.success || !orgId.success) {
    return { error: 'Retention is a number of days, from 1 to 3650.' }
  }

  try {
    const written = await asViewer(user.id, (tx) =>
      setOrgRetention(tx, orgId.data, days.data),
    )
    if (!written) {
      return { error: 'You do not have permission to change this setting.' }
    }
  } catch (error) {
    // The trigger raises `check_violation` when the window is past the Tier's
    // ceiling, which happens to a form rendered before the Tier changed.
    // Narrowed on that code rather than catching everything: a database that
    // is down would otherwise be reported as a Tier limit, and the Owner
    // would lower the number and be refused again with no trace anywhere.
    if (!isValueRefused(error)) throw error
    return {
      error:
        'That is longer than this Org’s Tier allows. The Tier page states the ceiling.',
    }
  }

  revalidatePath('/settings/org')
  return { saved: days.data }
}

/**
 * Whether the database refused the value itself, rather than anything else
 * that can go wrong on the way to a statement.
 *
 * `23514` is `check_violation`, which the retention trigger raises explicitly;
 * `P0001` is `raise_exception`, the default a `raise` carries, which is what
 * the two timezone guards raise. Everything else — a connection that died, a
 * statement timeout, a constraint added later — belongs in the logs and on an
 * error page rather than behind a sentence about one setting.
 */
const REFUSALS = new Set(['23514', 'P0001'])

const isValueRefused = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string' &&
  REFUSALS.has(error.code)
