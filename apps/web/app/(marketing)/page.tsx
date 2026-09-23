import Link from 'next/link'
import { SignedInLink } from './signed-in-link'

import { InstallCommand } from './install-command'
import { CONTACT_EMAIL, REPOSITORY } from './constants'
import { TierCard, TiersUnavailable } from './tier-card'
import { marketingTiers } from '../../lib/tiers'

// The landing page. `docs/design/marketing-site.md` fixes the order of the
// sections and the argument they make: Claude Code usage is spread across
// laptops, cloud sessions and CI, and nobody can see the total. The headline
// states it rather than asking it, because a question headline can be
// answered "I do not care" by a visitor on their way out.

// Ticket 66 owns distribution. Shell commands, since the block prints a `$`
// prompt: the same two lines a cloud environment's setup script runs (ticket
// 95). The install prompts for the URL and the key when it has no `--config`.
const INSTALL = [
  'claude plugin marketplace add NotTahaAli/sessclone',
  'claude plugin install sessclone',
]

const QUESTIONS = [
  {
    heading: 'Who spent it',
    body: 'Cost per Member, per Role, per seat. A Manager sees their own people and nobody else’s, because that rule lives in the database rather than in the page.',
  },
  {
    heading: 'On what',
    body: 'Cost per Project and per Device, keyed so one repository cloned by four people is one Project, and a cloud container that lives an hour is not a new machine every hour.',
  },
  {
    heading: 'And why',
    body: 'The transcript behind a Session, when a Member has turned archival on. It is off by default and it is the Member’s switch, not their Admin’s — an Org cannot turn it on for someone.',
  },
]

const STEPS = [
  {
    label: 'On the machine',
    body: 'A plugin hook reads the transcript Claude Code already writes. Nothing else is installed and no wrapper sits in front of the CLI.',
  },
  {
    label: 'On the wire',
    body: 'The Collector pushes from its cursor, so a steady-state turn costs a few hundred bytes rather than a resend of the session.',
  },
  {
    label: 'In the ledger',
    body: 'Usage is stored exactly as reported and Cost is computed when it is read, so a price correction reprices history instead of leaving it wrong.',
  },
]

// Placeholders, and they say so in their own text rather than only in the
// byline: this page is publicly routable, and a fabricated result that reads
// as real is a liability the moment anything points DNS at it.
const TESTIMONIALS = [
  {
    quote:
      'PLACEHOLDER — the shape of the quote we are looking for: one specific thing the team found in their own spend, and how long it took to find.',
    person: 'Placeholder, not a real customer',
    role: 'Platform lead, 30 engineers',
  },
  {
    quote:
      'PLACEHOLDER — the shape of the quote we are looking for: what changed in the conversation with finance once the number existed.',
    person: 'Placeholder, not a real customer',
    role: 'Engineering manager',
  },
  {
    quote:
      'PLACEHOLDER — the shape of the quote we are looking for: why a regulated team chose to run it themselves.',
    person: 'Placeholder, not a real customer',
    role: 'Staff engineer, regulated industry',
  },
]

const FAQ = [
  {
    question: 'Do you read our code?',
    answer:
      'No. Usage counters and identifiers are what the Collector reports, and that is all the dashboard needs. Transcripts contain source code, so archiving them is off by default and each Member turns it on for themselves, per Project. Nobody can turn it on for somebody else.',
  },
  {
    question: 'How does it see cloud sessions and CI?',
    answer:
      'The same plugin. A cloud environment installs it in its setup script, and the key goes in an API credential, so the proxy adds it on the way out and it never sits in the container. A cloud session keys by account rather than by container, so every container a Member burns through collapses into one Device instead of filling the dashboard with hours-old machines.',
  },
  {
    question: 'What happens when a session is killed?',
    answer:
      'The Collector reports from a cursor and re-reports on restart. A Turn has an identity, so the same Turn reported twice leaves one row — and a run that died mid-stream is marked incomplete rather than silently counted as a total.',
  },
  {
    question: 'Where do the prices come from?',
    answer:
      'A rate table with effective dates, seeded from published prices and checked at seed time. A Turn keeps the price that was live when it ran, and a model with no rate reads as unpriced rather than as zero.',
  },
  {
    question: 'Can we run it ourselves?',
    answer:
      'Yes, free, at any size. Self-hosting is a tier and not a footnote: your database, your storage, your network. It is AGPL-3.0, so keep the panel\u2019s licence notice and sessclone credit visible, and if you run a modified copy for other people, offer those users its source. Modify it privately and you owe nobody anything. Sending features built on top back as a pull request is an ask rather than a condition.',
  },
  {
    question: 'What does a seat mean?',
    answer:
      'A seat is a person, not a machine. One Member with a laptop, a cloud environment and a CI runner is one seat.',
  },
]

export default async function Landing() {
  const tiers = await marketingTiers()

  return (
    <>
      <section className="border-rule border-b">
        <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-5 py-14 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-20">
          <div className="flex flex-col gap-6">
            <p className="text-label text-accent-text font-mono uppercase">
              Open source · self-hostable
            </p>
            <h1 className="text-display font-serif sm:text-[52px] sm:leading-[1.1]">
              Your team runs Claude Code in three places. Count it as one.
            </h1>
            <p className="text-body text-text-secondary max-w-[52ch]">
              Laptops, cloud sessions and CI each report their own usage, and
              none of them reports the total. sessclone collects every Turn from
              all three, prices it from a dated rate table, and shows one number
              per Member, Project and Device.
            </p>
            <div className="flex flex-wrap gap-3">
              <SignedInLink variant="hero" />
              <a
                href={REPOSITORY}
                className="border-control-border text-body hover:bg-surface-hover flex h-[var(--control-h)] items-center border px-5"
              >
                Self-host it
              </a>
            </div>
            <InstallCommand commands={INSTALL} />
          </div>

          {/* The product shot. A placeholder until the dashboard exists —
              ticket 45 builds the surface this frame will hold. */}
          <div
            className="border-rule-strong bg-surface flex aspect-[4/3] items-center justify-center border"
            role="img"
            aria-label="Product screenshot placeholder: the sessclone costs dashboard"
          >
            <p className="text-label text-text-muted px-6 text-center font-mono uppercase">
              Product shot — the Costs view, once ticket 45 lands
            </p>
          </div>
        </div>
      </section>

      <section className="border-rule border-b">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-14">
          <h2 className="text-display font-serif">Three questions, one page</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            {QUESTIONS.map((claim) => (
              <div key={claim.heading} className="flex flex-col gap-2">
                <h3 className="text-heading">{claim.heading}</h3>
                <p className="text-body text-text-secondary">{claim.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-rule border-b">
        <div className="mx-auto grid w-full max-w-[1120px] gap-10 px-5 py-14 lg:grid-cols-2 lg:items-center">
          <div
            className="border-rule-strong bg-surface flex aspect-video items-center justify-center border"
            role="img"
            aria-label="Demo video placeholder: ninety seconds from install to first Turn"
          >
            <p className="text-label text-text-muted px-6 text-center font-mono uppercase">
              90-second demo — placeholder
            </p>
          </div>
          <div className="flex flex-col gap-6">
            <h2 className="text-display font-serif">
              From the machine to the ledger
            </h2>
            <ol className="flex flex-col gap-5">
              {STEPS.map((step, index) => (
                <li key={step.label} className="flex gap-4">
                  <span className="text-figure-lg text-text-muted font-mono">
                    {index + 1}
                  </span>
                  <div className="flex flex-col gap-1">
                    <h3 className="text-heading">{step.label}</h3>
                    <p className="text-body text-text-secondary">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="border-rule border-b">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-14">
          <h2 className="text-display font-serif">What it changed</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((testimonial) => (
              <figure
                key={testimonial.role}
                className="border-rule-strong bg-surface flex flex-col gap-4 border p-6"
              >
                <blockquote className="text-body">
                  “{testimonial.quote}”
                </blockquote>
                <figcaption className="text-caption text-text-muted">
                  {testimonial.person}
                  <br />
                  {testimonial.role}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="border-rule border-b">
        <div className="mx-auto w-full max-w-[1120px] px-5 py-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-display font-serif">Pricing</h2>
            <Link
              href="/pricing"
              className="text-body text-accent-text flex h-[var(--control-h)] items-center"
            >
              What each tier includes →
            </Link>
          </div>
          <p className="text-body text-text-secondary mt-3">
            A seat is a person, not a machine.
          </p>
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
        <div className="mx-auto w-full max-w-[1120px] px-5 py-14">
          <h2 className="text-display font-serif">Questions</h2>
          <dl className="mt-8 grid gap-8 md:grid-cols-2">
            {FAQ.map((entry) => (
              <div key={entry.question} className="flex flex-col gap-2">
                <dt className="text-heading">{entry.question}</dt>
                <dd className="text-body text-text-secondary">
                  {entry.answer}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section>
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-5 py-14">
          <h2 className="text-display font-serif">Talk to us</h2>
          <p className="text-body text-text-secondary max-w-[60ch]">
            Tell us how many seats you need and what you are trying to see.
            Enterprise terms, per-model rates you set yourselves and a retention
            policy of your own start with a conversation rather than a form.
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="bg-accent-fill text-accent-on-fill border-accent-border text-body flex h-[var(--control-h)] w-fit items-center border px-5"
          >
            {CONTACT_EMAIL}
          </a>
        </div>
      </section>
    </>
  )
}
