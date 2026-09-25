'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { APPEARANCE_COOKIE } from '../../lib/appearance'
import { DEMO_COOKIE } from '../../lib/demo'

import { appUrl } from '../../lib/auth/app-url'
import { safeNext } from '../../lib/auth/next-path'
import { parsePlan, planQuery, returnPath } from '../../lib/auth/plan'
import { supabaseServer } from '../../lib/supabase/server'
import { marketingTiers } from '../../lib/tiers'

// The two ways in, and the way out. Both ways in are passwordless: there is no
// `signUp`, no `signInWithPassword` and no password field anywhere in this
// app, because the only credential that can be lost is one that exists.
//
// GitHub is the path for people whose employer allows OAuth apps. A magic link
// is the path for the rest — several employers block third-party OAuth apps
// outright, and without a second route those teams simply cannot sign in.

// Where both routes come back to. Handles the OAuth code and the magic link's
// token alike.
const CALLBACK = '/auth/callback'

const Email = z.email().max(320)

/**
 * The query to hang on the callback URL, so a visitor who arrived from an
 * invitation link comes back to it (ticket 49).
 *
 * `safeNext` is the check, and the callback runs it again on the way back:
 * this one is a convenience, that one is the rule.
 */
const destination = async (formData: FormData) => {
  const next = safeNext(formData.get('next'))
  // Ticket 118: the plan a new sign-up asked for rides along too. Ignored by
  // the callback for anybody who already has an Org. Clamped to the Team
  // Tier's size here, the form's boundary, from the same cached rows the form
  // was drawn from.
  const team = (await marketingTiers()).find((tier) => tier.key === 'team')
  const query = [
    next ? `next=${encodeURIComponent(next)}` : '',
    planQuery(parsePlan(formData, team)),
  ].filter(Boolean)
  return query.length ? `?${query.join('&')}` : ''
}

/**
 * Ticket 137: signing in ends the demo. A real session already outranks the
 * demo cookie; dropping it here also keeps a failed or abandoned sign-in from
 * leaving somebody who asked for their own account inside the demo.
 */
const leaveDemo = async () => (await cookies()).delete(DEMO_COOKIE)

/** Sends the visitor to GitHub. Returns only by redirecting. */
export const signInWithGitHub = async (formData: FormData) => {
  await leaveDemo()
  const supabase = await supabaseServer()
  const next = await destination(formData)

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${appUrl()}${CALLBACK}${next}` },
  })

  if (error || !data.url) {
    redirect(returnPath(formData, 'error=github'))
  }

  redirect(data.url)
}

/** Emails a magic link. Says so whether or not the address is known. */
export const sendMagicLink = async (formData: FormData) => {
  await leaveDemo()
  const email = Email.safeParse(formData.get('email'))

  if (!email.success) {
    redirect(returnPath(formData, 'error=email'))
  }

  const supabase = await supabaseServer()

  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      emailRedirectTo: `${appUrl()}${CALLBACK}${await destination(formData)}`,
    },
  })

  // Deliberately the same answer either way. Telling a visitor that an address
  // is unknown turns this form into a way to ask whether somebody has an
  // account here, which is worth more to an attacker than it is to a person
  // who mistyped their own email.
  if (error) {
    redirect(returnPath(formData, 'error=link'))
  }

  redirect(returnPath(formData, 'sent=1'))
}

export const signOut = async () => {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()

  // Ticket 77: the appearance cookie goes with the session. It holds nothing
  // secret, but a shared machine would otherwise paint the next person's
  // sign-in page in the last person's colours, which reads as though they had
  // not signed out properly.
  const store = await cookies()
  store.delete(APPEARANCE_COOKIE)
  // Ticket 137: signing out of the demo leaves it.
  store.delete(DEMO_COOKIE)

  redirect('/sign-in')
}
