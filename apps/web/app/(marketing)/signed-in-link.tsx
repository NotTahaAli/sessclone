import Link from 'next/link'
import { Suspense } from 'react'

import { sessionUser } from '../../lib/supabase/server'
import { buttonClass, pillClass } from '../_ui/primitives'

// A signed-in visitor on the marketing site was still being told to sign in
// (Taha, 2026-09-22). The header button and the hero's own call to action both
// pointed at `/sign-in` unconditionally, because the marketing pages are
// prerendered and a prerender cannot know who is asking.
//
// So the link streams instead. The prerendered shell carries the hero's
// signed-out wording, and a placeholder for the header's button (ticket 138),
// and the session read fills both once it lands; a crawler gets the resolved
// links in the same response. Ticket 83's shells
// stay non-empty, which `scripts/check-shells.mjs` checks.
//
// The marketing page itself is not redirected away from: somebody signed in
// may still want to read it, and the pricing and repository links beside this
// one are why. `/sign-in` is different — there is nothing on it for a person
// who is already signed in — so the Proxy sends them on rather than rendering
// a form that would sign them in as themselves again.

/**
 * The two places this appears, as data rather than as props.
 *
 * Each one's fallback is an element, and an element built per render and
 * handed to `Suspense` is what `react-perf/jsx-no-jsx-as-prop` is about. Both
 * call sites are fixed, so both variants are built once at module load.
 */
const VARIANTS = {
  // The nav's is a pill: the hero's filled button is the page's one.
  header: {
    // Wide enough for either label, so the pill keeps one width from the
    // placeholder through "Sign in" or "Dashboard".
    className: `${pillClass} min-w-[5.75rem] justify-center`,
    signedOut: 'Sign in',
    signedOutHref: '/sign-in',
    signedIn: 'Dashboard',
  },
  hero: {
    className: `${buttonClass('primary')} h-10 px-4 text-[14px]`,
    signedOut: 'Join the waitlist',
    signedOutHref: '/sign-up',
    signedIn: 'Open the dashboard',
  },
} as const

export type Variant = keyof typeof VARIANTS

const FALLBACKS: Record<Variant, React.ReactElement> = {
  // The header's holds the place and says nothing (ticket 138's review): a
  // signed-in reader saw "Sign in" flash before "Dashboard" replaced it. The
  // same pill at the same width, so nothing beside it moves either; its hidden
  // text is the longer label, in case the minimum is ever short of it.
  header: (
    <span aria-hidden="true" className={VARIANTS.header.className}>
      <span className="invisible">{VARIANTS.header.signedIn}</span>
    </span>
  ),
  hero: (
    <Link
      href={VARIANTS.hero.signedOutHref}
      className={VARIANTS.hero.className}
    >
      {VARIANTS.hero.signedOut}
    </Link>
  ),
}

export function SignedInLink({ variant }: { variant: Variant }) {
  return (
    <Suspense fallback={FALLBACKS[variant]}>
      <SignedInResolved variant={variant} />
    </Suspense>
  )
}

/** The link once the session is read; exported for its test. */
export async function SignedInResolved({ variant }: { variant: Variant }) {
  const user = await sessionUser()
  const { className, signedOut, signedOutHref, signedIn } = VARIANTS[variant]

  return (
    <Link href={user ? '/costs' : signedOutHref} className={className}>
      {user ? signedIn : signedOut}
    </Link>
  )
}
