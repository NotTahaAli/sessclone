import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import {
  EmailBelongsToAnotherAccount,
  ensureOrgForSigner,
} from '../../../lib/auth/bootstrap'
import { supabaseServer } from '../../../lib/supabase/server'

// Where both ways in come back to.
//
// They arrive carrying different things. GitHub's OAuth flow returns a PKCE
// `code`, exchanged for a session. A magic link returns a `token_hash` and a
// `type`, verified instead — which template Supabase sends depends on the
// project's email settings, so both shapes are handled here rather than in two
// routes that each work for half the deployments.
//
// Either way the session is established and then `ensureOrgForSigner` runs, so
// a first-time signer lands on a dashboard that has an Org in it rather than
// on an empty page.

// The OTP types a link in an email can legitimately carry. Validated rather
// than asserted: this is a query string, which is a trust boundary, and an
// unrecognised value should be a refused sign-in rather than a string handed
// to the Supabase client to interpret.
const EmailOtp = z.enum([
  'email',
  'magiclink',
  'signup',
  'invite',
  'recovery',
  'email_change',
])

// A provider's own error code, when it reports one. Matched rather than
// forwarded as it arrives: this ends up on our sign-in page, and the
// `error_description` beside it is free text from a third party, which is not
// something to render. `app/sign-in/provider-error.tsx` applies the same rule
// to the fragment, which is where Supabase usually puts this.
const PROVIDER_CODE = /^[a-z_]{1,64}$/

const failed = (request: NextRequest, reason: string, code?: string) => {
  const url = request.nextUrl.clone()
  url.pathname = '/sign-in'
  url.search = `?error=${reason}`
  if (code) url.search += `&code=${code}`
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const tokenHash = params.get('token_hash')
  const type = EmailOtp.safeParse(params.get('type'))

  // Only a path within this deployment, never an absolute URL somebody put in
  // the query string: an open redirect on the sign-in callback hands a
  // freshly-minted session to wherever the link says.
  const requested = params.get('next')
  // `/costs` and not `/`: `/` is the marketing page (ticket 26), and landing
  // somebody there the moment they sign in is landing them where they already
  // decided to leave. The dashboard's home is Costs (ticket 45).
  const next = requested?.startsWith('/') ? requested : '/costs'

  // The provider refused before we ever got a code. Distinguished from a link
  // that arrived with nothing, which is what this route used to call it: the
  // two look identical here — no code, no token — and only one of them is the
  // visitor's problem.
  if (params.get('error')) {
    const reported = params.get('error_code')
    return failed(
      request,
      'provider',
      reported && PROVIDER_CODE.test(reported) ? reported : 'unknown',
    )
  }

  const supabase = await supabaseServer()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return failed(request, 'exchange')
  } else if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({
      type: type.data,
      token_hash: tokenHash,
    })
    if (error) return failed(request, 'link')
  } else {
    return failed(request, 'callback')
  }

  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims

  if (!claims?.sub || typeof claims.email !== 'string') {
    return failed(request, 'session')
  }

  // The session cookie is already written by this point, so an exception here
  // leaves somebody signed in with no Org and a 500 they can only repeat. A
  // refused sign-in they can read is the better end of that.
  try {
    await ensureOrgForSigner(claims.sub, claims.email)
  } catch (cause) {
    // The visitor is told their Org could not be set up and nothing more, on
    // purpose: the reason is a database error, which names tables and roles.
    // But it was previously discarded here as well, which left the operator
    // with a sign-in page that reported a failure nothing anywhere explained —
    // a misconfigured `DATABASE_URL` and a missing grant are the same sentence
    // from the outside. Not a logger: there is no logging decision in this app
    // yet (ticket 45), and inventing one here would be the wrong place.
    if (!(cause instanceof EmailBelongsToAnotherAccount)) {
      console.error('sign-in: could not set up an Org for the signer', cause)
    }

    await supabase.auth.signOut()
    return failed(
      request,
      cause instanceof EmailBelongsToAnotherAccount ? 'identity' : 'bootstrap',
    )
  }

  const destination = request.nextUrl.clone()
  destination.pathname = next
  destination.search = ''
  return NextResponse.redirect(destination)
}
