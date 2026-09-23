import { Suspense } from 'react'

import { sendMagicLink, signInWithGitHub } from './actions'
import { readAnonymously } from '../../lib/db'
import { invitationOrg } from '../../lib/invitations'
import { logoPath } from '../../lib/org-logo'
import { SIGNUP_PLANS } from '../../lib/subscriptions'
import { marketingTiers, tierPrice } from '../../lib/tiers'
import { OrgMark } from '../org-mark'
import { LogoMark } from '../_ui/logo'
import { buttonClass, inputClass } from '../_ui/primitives'
import { invitationToken, safeNext } from '../../lib/auth/next-path'
import { ProviderError } from './provider-error'
import { PanelCredit } from '../(dashboard)/credit'

// Ticket 83: the page prerenders, and the query string streams into it.
//
// This is the page a signed-out visitor waits on, so it is the one where a
// static shell is worth the most: the heading and both forms are the same for
// everybody, and only two things are not — the error a failed round trip
// reports, and the `next` path an invitation link carries. Those two read
// `searchParams`, so they sit behind a Suspense boundary and the rest of the
// page is prerendered.

// Styled from the design system's tokens (ticket 16), in the same one-column
// frame `app/join/[token]/page.tsx` uses: both are pages a visitor reaches
// before they are in any Org, so neither has a shell to sit in and both carry
// the panel's Appropriate Legal Notices themselves (ticket 79).

const MESSAGES: Record<string, string> = {
  github: 'GitHub sign-in could not be started. Try again, or use a link.',
  email: 'That does not look like an email address.',
  link: 'The link could not be sent. Try again in a moment.',
  exchange: 'That sign-in could not be completed. Start again.',
  callback: 'That link is missing something. Start again.',
  session: 'Signed in, but the session did not stick. Start again.',
  identity:
    'That email address already belongs to an account signed in a different way. Use the way you signed in the first time.',
  bootstrap: 'Signed in, but your organisation could not be set up. Try again.',
}

// Matched, never rendered as it arrives — see `app/auth/callback/route.ts`.
const PROVIDER_CODE = /^[a-z_]{1,64}$/

/** Direction A's round button at full width (ticket 111): one primary. */
const PRIMARY = `${buttonClass('primary')} w-full`
const SECONDARY = `${buttonClass()} w-full`

type Query = Promise<{
  error?: string
  sent?: string
  code?: string
  next?: string
  /** A plan preselected by the pricing page's "Join waitlist". */
  plan?: string
}>

/**
 * Where to come back to, carried through both forms so an invitation link
 * survives the round trip to GitHub or to an inbox.
 *
 * A hidden input rather than a value the page bakes in: it reads the query
 * string, which is what keeps the rest of the page prerenderable.
 */
async function ReturnTo({ searchParams }: { searchParams: Query }) {
  const returnTo = safeNext((await searchParams).next)
  return returnTo ? <input type="hidden" name="next" value={returnTo} /> : null
}

/**
 * The Org's mark, when this page was reached from an invitation (ticket 77).
 *
 * Only then: `/sign-in` on its own belongs to the deployment, not to an Org,
 * and a signed-out visitor has no Org for it to show. The token is already in
 * the URL the visitor followed, so nothing is disclosed by resolving it — and
 * a token that is spent, revoked or invented resolves to nothing, which
 * renders nothing.
 */
async function InvitedBy({ searchParams }: { searchParams: Query }) {
  const token = invitationToken(safeNext((await searchParams).next))
  if (!token) return null

  const invitation = await readAnonymously((tx) => invitationOrg(tx, token))
  if (!invitation) return null

  return (
    <p className="text-text-secondary mt-4 flex items-center gap-2 text-body">
      <OrgMark
        name={invitation.orgName}
        src={
          invitation.logo ? logoPath(invitation.orgId, invitation.logo) : null
        }
        size={32}
      />
      You were invited to {invitation.orgName}.
    </p>
  )
}

/**
 * The plan a new sign-up asks for (ticket 118): Personal, or Team and its
 * size. It is only an ask — the Org waits for the operator to approve it
 * (ticket 119) — and it is ignored for anybody who already has an Org.
 *
 * Absent on the way to an invitation, where the visitor is joining somebody
 * else's Org rather than starting one. The Tiers are the cached rows the
 * pricing page reads, so a size the operator changed is the size offered.
 */
async function PlanChoice({ searchParams }: { searchParams: Query }) {
  const { next, plan } = await searchParams
  if (invitationToken(safeNext(next))) return null

  const tiers = (await marketingTiers()).filter((tier) =>
    (SIGNUP_PLANS as readonly string[]).includes(tier.key),
  )
  if (tiers.length === 0) return null
  const team = tiers.find((tier) => tier.key === 'team')
  // Only a key on offer is honoured; anything else falls back to the first.
  const chosen = tiers.some((tier) => tier.key === plan) ? plan : tiers[0]!.key

  return (
    <fieldset className="mt-6 flex flex-col gap-2">
      <legend className="text-text-muted mb-2 text-caption">
        New here? Choose a plan
      </legend>
      {tiers.map((tier) => (
        <label key={tier.key} className="flex items-center gap-2 text-body">
          <input
            type="radio"
            name="plan"
            value={tier.key}
            defaultChecked={tier.key === chosen}
          />
          {tier.name}
          <span className="text-text-muted text-caption">
            {[tierPrice(tier).amount, tierPrice(tier).unit]
              .filter(Boolean)
              .join(' ')}
          </span>
        </label>
      ))}
      {team ? (
        <label className="text-text-secondary flex items-center gap-2 text-caption">
          Team size
          <input
            name="seats"
            type="number"
            min={team.minSeats ?? 1}
            max={team.maxSeats ?? undefined}
            defaultValue={team.minSeats ?? 2}
            className={`${inputClass} w-20`}
          />
        </label>
      ) : null}
      <p className="text-text-muted text-caption">
        Paid plans open by invitation from the waitlist: signing up puts your
        organisation on it, and it opens once approved.
      </p>
    </fieldset>
  )
}

/** What a failed round trip left in the query string, if anything. */
async function Notices({ searchParams }: { searchParams: Query }) {
  const { error, sent, code } = await searchParams

  return (
    <>
      {error === 'provider' ? (
        <p
          role="alert"
          className="border-bad-border bg-bad-bg text-bad-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          The provider refused the sign-in (
          {code && PROVIDER_CODE.test(code) ? code : 'unknown'}). Nothing is
          wrong with your account. Check the provider&apos;s settings in
          Supabase, or use a link instead.
        </p>
      ) : error ? (
        <p
          role="alert"
          className="border-bad-border bg-bad-bg text-bad-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          {MESSAGES[error] ?? 'Something went wrong.'}
        </p>
      ) : null}

      {sent ? (
        <p
          role="status"
          className="border-ok-border bg-ok-bg text-ok-text mt-4 rounded-md border px-3 py-2 text-caption"
        >
          If that address has an account, a sign-in link is on its way. The link
          works once and expires.
        </p>
      ) : null}
    </>
  )
}

export default function SignIn({ searchParams }: { searchParams: Query }) {
  return (
    <main className="mx-auto flex max-w-md flex-col px-4 py-16">
      <LogoMark size={28} className="text-text mb-4" />
      <h1 className="text-heading-lg">Sign in to sessclone</h1>

      <Suspense fallback={null}>
        <InvitedBy searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <Notices searchParams={searchParams} />
      </Suspense>

      {/* The same failure, when Supabase reported it in the fragment. */}
      <ProviderError />

      {/* One form and two ways to submit it, so the plan below travels with
          either (ticket 118). GitHub skips validation: it needs no address. */}
      <form action={sendMagicLink}>
        <Suspense fallback={null}>
          <ReturnTo searchParams={searchParams} />
        </Suspense>

        {/* First, so the choice is made before either button is pressed. */}
        <Suspense fallback={null}>
          <PlanChoice searchParams={searchParams} />
        </Suspense>

        <button
          type="submit"
          formAction={signInWithGitHub}
          formNoValidate
          className={`${PRIMARY} mt-6`}
        >
          Continue with GitHub
        </button>

        <div className="border-rule mt-6 flex flex-col gap-2 border-t pt-4">
          <label htmlFor="email" className="text-text-muted text-caption">
            Or get a sign-in link by email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            className={`${inputClass} w-full`}
          />
          <button type="submit" className={SECONDARY}>
            Email me a link
          </button>
        </div>
      </form>

      <p className="text-text-muted mt-6 text-caption">
        There is no password to set or forget. Signing in for the first time
        creates an organisation with you as its owner, on the plan you chose.
      </p>

      <div className="mt-12">
        <PanelCredit />
      </div>
    </main>
  )
}
