import Link from 'next/link'
import { Suspense } from 'react'

import { signedInUser } from '../../lib/supabase/server'

// A signed-in visitor on the marketing site was still being told to sign in
// (Taha, 2026-09-22). The header button and the hero's own call to action both
// pointed at `/sign-in` unconditionally, because the marketing pages are
// prerendered and a prerender cannot know who is asking.
//
// So the link streams instead. The prerendered shell carries the signed-out
// wording — right for almost every visitor, and what a crawler sees — and the
// session read swaps it for the dashboard once it lands. Ticket 83's shells
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
  header: {
    className:
      'bg-accent-fill text-accent-on-fill border-accent-border flex h-[var(--control-h)] items-center border px-4',
    signedOut: 'Sign in',
    signedIn: 'Dashboard',
  },
  hero: {
    className:
      'bg-accent-fill text-accent-on-fill border-accent-border text-body flex h-[var(--control-h)] items-center border px-5',
    signedOut: 'Start counting',
    signedIn: 'Open the dashboard',
  },
} as const

export type Variant = keyof typeof VARIANTS

const FALLBACKS: Record<Variant, React.ReactElement> = {
  header: (
    <Link href="/sign-in" className={VARIANTS.header.className}>
      {VARIANTS.header.signedOut}
    </Link>
  ),
  hero: (
    <Link href="/sign-in" className={VARIANTS.hero.className}>
      {VARIANTS.hero.signedOut}
    </Link>
  ),
}

export function SignedInLink({ variant }: { variant: Variant }) {
  return (
    <Suspense fallback={FALLBACKS[variant]}>
      <Resolved variant={variant} />
    </Suspense>
  )
}

async function Resolved({ variant }: { variant: Variant }) {
  const user = await signedInUser()
  const { className, signedOut, signedIn } = VARIANTS[variant]

  return (
    <Link href={user ? '/costs' : '/sign-in'} className={className}>
      {user ? signedIn : signedOut}
    </Link>
  )
}
