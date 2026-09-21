'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { appUrl } from '../../lib/auth/app-url'
import { supabaseServer } from '../../lib/supabase/server'

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

/** Sends the visitor to GitHub. Returns only by redirecting. */
export const signInWithGitHub = async () => {
  const supabase = await supabaseServer()

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: `${appUrl()}${CALLBACK}` },
  })

  if (error || !data.url) {
    redirect('/sign-in?error=github')
  }

  redirect(data.url)
}

/** Emails a magic link. Says so whether or not the address is known. */
export const sendMagicLink = async (formData: FormData) => {
  const email = Email.safeParse(formData.get('email'))

  if (!email.success) {
    redirect('/sign-in?error=email')
  }

  const supabase = await supabaseServer()

  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${appUrl()}${CALLBACK}` },
  })

  // Deliberately the same answer either way. Telling a visitor that an address
  // is unknown turns this form into a way to ask whether somebody has an
  // account here, which is worth more to an attacker than it is to a person
  // who mistyped their own email.
  if (error) {
    redirect('/sign-in?error=link')
  }

  redirect('/sign-in?sent=1')
}

export const signOut = async () => {
  const supabase = await supabaseServer()
  await supabase.auth.signOut()
  redirect('/sign-in')
}
