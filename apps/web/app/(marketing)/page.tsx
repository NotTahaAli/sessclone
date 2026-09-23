import { InstallCommand } from './install-command'
import { FRAME, REPOSITORY } from './constants'
import { SignedInLink } from './signed-in-link'
import { TiersUnavailable } from './tiers-unavailable'
import { shortPrice } from '../../lib/plans'
import { marketingTiers } from '../../lib/tiers'
import { CANONICAL_ORIGIN, SITE_DESCRIPTION, canonical } from '../../lib/site'
import {
  buttonClass,
  cardClass,
  Row,
  SectionBreak,
  StatusGlyph,
} from '../_ui/primitives'

// The landing page, in Direction A (ticket 114): the dashboard's rows and
// status card, so the product looks like its own marketing. The argument is
// unchanged from `docs/design/marketing-site.md`: usage is spread across
// laptops, cloud sessions and CI, and nobody sees the total. The headline
// states it rather than asking it.

// Ticket 66 owns distribution. Shell commands, since the block prints a `$`
// prompt: the same two lines a cloud environment's setup script runs (ticket
// 95). The install prompts for the URL and the key when it has no `--config`.
const INSTALL = [
  'claude plugin marketplace add NotTahaAli/sessclone',
  'claude plugin install sessclone',
]

// An illustration of the status card, and labelled as one: this page is
// public, and figures that read as a real Org's are a liability.
const EXAMPLE = [
  { state: 'ok', where: 'Laptop · 41 turns', cost: '$6.12' },
  { state: 'ok', where: 'Cloud sessions · 18 turns', cost: '$2.40' },
  { state: 'live', where: 'CI · 4 turns, running', cost: '$0.31' },
] as const

const HOW = [
  {
    lead: 'ok',
    name: 'On the machine',
    meta: 'plugin',
    sub: 'A hook reads each finished Turn. Nothing is proxied.',
  },
  {
    lead: 'ok',
    name: 'On the wire',
    meta: '~300 B/turn',
    sub: 'Pushes from its cursor, never the whole session.',
  },
  {
    // The live glyph: the ledger is where a Turn is still being priced.
    lead: 'live',
    name: 'In the ledger',
    meta: 'priced',
    sub: 'Dated rates. An unknown one reads as unpriced, never $0.',
  },
] as const

const FAQ = [
  {
    question: 'Do you read our code?',
    answer:
      'No. Usage counters and identifiers are what the Collector reports, and that is all the dashboard needs. Transcripts contain source code, so archiving them is off by default and each Member turns it on for themselves, per Project. Nobody can turn it on for somebody else.',
  },
  {
    question: 'How does it see cloud sessions and CI?',
    answer:
      'The same plugin. A cloud environment installs it in its setup script, and the key goes in an API credential, so the proxy adds it on the way out and it never sits in the container. A cloud session keys by account rather than by container, so every container a Member burns through collapses into one Device.',
  },
  {
    question: 'What happens when a session is killed?',
    answer:
      'The Collector reports from a cursor and re-reports on restart. A Turn has an identity, so the same Turn reported twice leaves one row, and a run that died mid-stream is marked incomplete rather than silently counted as a total.',
  },
  {
    question: 'Can we run it ourselves?',
    answer:
      'Yes, free, at any size: your database, your storage, your network. It is AGPL-3.0, so keep the panel’s licence notice and SessClone credit visible, and if you run a modified copy for other people, offer those users its source.',
  },
]

export const metadata = { alternates: { canonical: canonical('/') } }

// Structured data for search results: what the product is and where its
// source lives. No price here, since prices are rows in the `tiers` table and
// a second copy would drift from them.
const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'SessClone',
  url: CANONICAL_ORIGIN,
  description: SITE_DESCRIPTION,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS, Linux, Windows',
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  sameAs: [REPOSITORY],
})
const JSON_LD_HTML = { __html: JSON_LD }

export default async function Landing() {
  const tiers = await marketingTiers()

  return (
    <>
      <script
        type="application/ld+json"
        // A constant built above from string literals, nothing a visitor sends.
        // oxlint-disable-next-line no-danger
        dangerouslySetInnerHTML={JSON_LD_HTML}
      />
      <section
        className={`${FRAME} grid grid-cols-[minmax(0,1fr)] gap-8 pt-4 pb-6 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:gap-14 lg:pt-14 lg:pb-10`}
      >
        <div>
          <h1 className="text-[31px] leading-[1.08] font-semibold tracking-[-0.025em] text-balance lg:text-[56px] lg:tracking-[-0.035em]">
            Your team runs Claude Code in three places.{' '}
            <span className="text-accent-text">Count it as one.</span>
          </h1>
          <p className="text-text-muted mt-3 mb-4 max-w-[30em] text-[14.5px] lg:mt-4 lg:mb-6 lg:text-[17px]">
            Laptops, cloud sessions and CI each report their own usage.
            SessClone collects every Turn into one ledger your whole Org can
            read, priced and per person.
          </p>
          <div className="mb-4 flex flex-wrap gap-2">
            <SignedInLink variant="hero" />
            <a
              href={REPOSITORY}
              className={`${buttonClass()} h-10 px-4 text-[14px]`}
            >
              Self-host free
            </a>
          </div>
          <div className="max-w-[34rem]">
            <InstallCommand commands={INSTALL} />
          </div>
        </div>

        <figure className={`${cardClass} rounded-xl`}>
          <figcaption className="mb-1 flex items-baseline gap-2">
            <span className="text-text-muted text-label uppercase">Status</span>
            <span className="text-[13px] font-medium">Collected today</span>
            <span className="text-text-muted ml-auto text-caption">
              An example Org
            </span>
          </figcaption>
          <ul className="text-[13px]">
            {EXAMPLE.map((line) => (
              <li
                key={line.where}
                className="grid grid-cols-[16px_1fr_auto] gap-1.5 py-0.5"
              >
                <StatusGlyph state={line.state} />
                <span>{line.where}</span>
                <span className="text-text-muted font-mono text-caption">
                  {line.cost}
                </span>
              </li>
            ))}
            <li className="border-rule mt-1.5 grid grid-cols-[16px_1fr_auto] gap-1.5 border-t pt-1.5">
              <span />
              <span className="font-medium">One Org, one total</span>
              <span className="font-mono text-caption">$8.83</span>
            </li>
          </ul>
        </figure>
      </section>

      <section
        className={`${FRAME} grid grid-cols-[minmax(0,1fr)] gap-2 pb-10 lg:grid-cols-2 lg:gap-14 lg:pb-14`}
      >
        <div>
          <SectionBreak>How it counts</SectionBreak>
          {HOW.map((step) => (
            <Row
              key={step.name}
              lead={step.lead}
              name={step.name}
              meta={step.meta}
              sub={step.sub}
            />
          ))}
        </div>
        <div>
          <SectionBreak>Pricing · per person, not per machine</SectionBreak>
          {tiers.length === 0 ? (
            <TiersUnavailable />
          ) : (
            tiers.map((tier) => (
              <Row
                key={tier.key}
                href="/pricing"
                name={tier.name}
                value={shortPrice(tier)}
                sub={tier.description}
              />
            ))
          )}
        </div>
      </section>

      <section className={`${FRAME} pb-12 lg:pb-16`}>
        <SectionBreak>Questions</SectionBreak>
        <dl className="mt-3 grid gap-x-14 gap-y-5 lg:grid-cols-2">
          {FAQ.map((entry) => (
            <div key={entry.question}>
              <dt className="text-[15px] font-medium">{entry.question}</dt>
              <dd className="text-text-muted mt-1 text-body">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  )
}
