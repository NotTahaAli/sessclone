import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { ensureOrgForSigner } from '../../../lib/auth/bootstrap'
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

const failed = (request: NextRequest, reason: string) => {
  const url = request.nextUrl.clone()
  url.pathname = '/sign-in'
  url.search = `?error=${reason}`
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
  const next = requested?.startsWith('/') ? requested : '/'

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

  await ensureOrgForSigner(claims.sub, claims.email)

  const destination = request.nextUrl.clone()
  destination.pathname = next
  destination.search = ''
  return NextResponse.redirect(destination)
}
