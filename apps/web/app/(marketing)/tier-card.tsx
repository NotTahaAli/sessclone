import Link from 'next/link'

import { CONTACT_EMAIL, REPOSITORY } from './constants'
import { tierPrice, tierSeats, type MarketingTier } from '../../lib/tiers'

// TierCard. Three variants — default, highlighted, self-hosted — and the
// self-hosted one says free plainly, because it is the honest path and
// pretending otherwise costs trust. Ticket 47 reuses this signed in, where
// the Owner sees the Tier the Org is on.
//
// Team is marked as the common choice with a clay border rather than a larger
// card: a card that grows breaks the row at phone width, where every card is
// full width anyway and the size would say nothing.
export function TierCard({
  tier,
  highlighted = false,
}: {
  tier: MarketingTier
  highlighted?: boolean
}) {
  const price = tierPrice(tier)
  const selfHosted = tier.key === 'self_hosted'
  const contact = price.amount === 'Contact'

  return (
    <section
      className={`bg-surface flex flex-col gap-5 border p-6 ${
        highlighted ? 'border-accent-border' : 'border-rule-strong'
      }`}
      aria-labelledby={`tier-${tier.key}`}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id={`tier-${tier.key}`} className="text-heading-lg">
            {tier.name}
          </h3>
          {highlighted ? (
            <span className="text-micro text-accent-text border-accent-border border px-2 py-1 font-mono uppercase">
              Most teams
            </span>
          ) : null}
        </div>
        <p className="text-body text-text-secondary">{tier.description}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-figure-xl font-mono">{price.amount}</p>
        <p className="text-caption text-text-muted">
          {price.unit ?? 'Talk to us about terms and seats'}
        </p>
        <p className="text-caption text-text-muted font-mono">
          {tierSeats(tier)}
        </p>
      </div>

      <ul className="text-body flex flex-col gap-2">
        {tier.includes.map((line) => (
          <li key={line} className="flex gap-2">
            {/* A glyph, not colour alone. */}
            <span aria-hidden="true" className="text-text-muted">
              ·
            </span>
            <span>{line}</span>
          </li>
        ))}
        <li className="text-text-muted flex gap-2">
          <span aria-hidden="true">·</span>
          <span>
            {tier.archivalAvailable
              ? 'Transcript archival available, opt-in per Member'
              : 'No transcript archival on this tier'}
          </span>
        </li>
      </ul>

      {selfHosted ? (
        <a
          href={REPOSITORY}
          className="border-control-border text-body hover:bg-surface-hover mt-auto flex h-[var(--control-h)] items-center justify-center border px-4"
        >
          Read the install guide
        </a>
      ) : contact ? (
        <a
          href={`mailto:${CONTACT_EMAIL}?subject=sessclone%20Enterprise`}
          className="border-control-border text-body hover:bg-surface-hover mt-auto flex h-[var(--control-h)] items-center justify-center border px-4"
        >
          Contact us
        </a>
      ) : (
        <Link
          href="/sign-in"
          className={`text-body mt-auto flex h-[var(--control-h)] items-center justify-center border px-4 ${
            highlighted
              ? 'bg-accent-fill text-accent-on-fill border-accent-border'
              : 'border-control-border hover:bg-surface-hover'
          }`}
        >
          Start on {tier.name}
        </Link>
      )}
    </section>
  )
}
