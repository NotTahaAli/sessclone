import { CONTACT_EMAIL, REPOSITORY } from '../constants'
import { TierCard, TiersUnavailable } from '../tier-card'
import { marketingTiers } from '../../../lib/tiers'

// The pricing page. Four tiers in one row on desktop, stacked on a phone,
// Team marked as the common choice with a clay border rather than a larger
// card. Self-hosting is presented as a real tier because it is the honest
// answer to "can we run this ourselves", and a visitor who finds it buried
// assumes it is crippled.
export const metadata = {
  title: 'Pricing — sessclone',
  description:
    'Self-hosted free at any size, $5 a month for one person, $10 per seat for a team. A seat is a person, not a machine.',
}

export default async function Pricing() {
  const tiers = await marketingTiers()

  return (
    <>
      <section className="border-rule border-b">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-5 py-14">
          <h1 className="text-display font-serif">
            A seat is a person, not a machine.
          </h1>
          <p className="text-body text-text-secondary max-w-[60ch]">
            One Member with a laptop, a cloud environment and a CI runner is one
            seat. Every tier collects from all three; what changes between them
            is how many people share the Org and how long the history is kept.
          </p>
        </div>
      </section>

      <section className="border-rule border-b">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-14">
          <h2 className="text-display font-serif">Four tiers</h2>
          {tiers.length === 0 ? (
            <div className="mt-8">
              <TiersUnavailable />
            </div>
          ) : (
            <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
              {tiers.map((tier) => (
                <TierCard
                  key={tier.key}
                  tier={tier}
                  highlighted={tier.key === 'team'}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="border-rule border-b">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-5 py-14">
          <h2 className="text-display font-serif">Running it yourself</h2>
          <p className="text-body text-text-secondary max-w-[60ch]">
            Self-hosting is free at any size and gets every feature. It is the
            same code this deployment runs, against your own Postgres and your
            own object storage, and the plugin installs from your fork by the
            identical path.
          </p>
          <ul className="text-body text-text-secondary flex max-w-[60ch] flex-col gap-2">
            <li>
              The panel&apos;s licence notice and sessclone credit stay visible.
            </li>
            <li>
              Hand a copy to somebody, or run a modified copy for them, and they
              get its source.
            </li>
            <li>Modify it privately and you owe nobody anything.</li>
          </ul>
          <p className="text-caption text-text-muted max-w-[60ch]">
            That is AGPL-3.0-only, with the panel notice as an additional term
            under its section 7(b). Sending features built on top back as a pull
            request is an ask and not a condition — no open licence enforces
            that one, and the repository says so rather than implying otherwise.
          </p>
          <a
            href={REPOSITORY}
            className="border-control-border text-body hover:bg-surface-hover flex h-[var(--control-h)] w-fit items-center border px-5"
          >
            sessclone on GitHub
          </a>
        </div>
      </section>

      <section>
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-5 py-14">
          <h2 className="text-display font-serif">
            Eleven seats and up, or terms of your own
          </h2>
          <p className="text-body text-text-secondary max-w-[60ch]">
            Tell us how many seats you need and what you are trying to see.
            Negotiated per-model rates and a retention policy of your own are a
            conversation rather than a form.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=sessclone%20Enterprise`}
            className="bg-accent-fill text-accent-on-fill border-accent-border text-body flex h-[var(--control-h)] w-fit items-center border px-5"
          >
            hello@sessclone.dev
          </a>
        </div>
      </section>
    </>
  )
}
