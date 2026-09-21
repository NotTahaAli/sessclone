import { SpendChart } from './spend-chart'
import { EmptyState } from '../empty-state'
import { InstallCollector } from '../install-collector'
import { PageHeader } from '../page-header'
import { appUrl } from '../../../lib/auth/app-url'
import { asViewer } from '../../../lib/db'
import {
  onboardingFacts,
  onboardingState,
  type OnboardingFacts,
} from '../../../lib/onboarding'
import {
  currentMonth,
  dailySpend,
  spendSeries,
  type LocalRange,
  type SpendSeries,
} from '../../../lib/series'
import { currentViewer } from '../../../lib/viewer'

// Costs. Ticket 45 owns the frame and the states before there is anything to
// draw; ticket 52 owns the first thing drawn in it, which is spend over time.
// The breakdowns by Member, Project and Device are 54 to 56 and hang from the
// same range.
//
// The range is the current calendar month in the Org's timezone, which
// `docs/design/dashboard-wireframes.md` chose because it is the period a bill
// is drawn on. Ticket 53 puts it in the URL and gives it presets; until then
// it is the default and nothing else, and every piece below already takes it
// as an argument rather than deciding for itself.

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})
const compact = new Intl.NumberFormat('en-US', { notation: 'compact' })
const whole = new Intl.NumberFormat('en-US')
const monthName = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * Spend over time, and the four figures that say what the bars are made of.
 *
 * The unpriced count is a tile rather than a footnote: `turn_costs` leaves a
 * Turn's cost null when a quantity it consumed has no Rate, so the total is a
 * floor whenever that count is not zero, and a reader who cannot see it reads
 * the floor as the answer (ADR 0002).
 */
function OverTime({
  series,
  range,
}: {
  series: SpendSeries
  range: LocalRange
}) {
  const month = monthName.format(new Date(`${range.from}T00:00:00Z`))

  if (series.turns === 0) {
    // Not the onboarding state: Turns exist, this window has none of them.
    return (
      <EmptyState headline={`Nothing in ${month}`}>
        Turns have arrived, but none of them fall in this period. Choosing a
        wider one arrives with the date-range control.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Cost" value={money.format(series.costUsd)}>
          {month}
          {series.unpricedTurns > 0 ? ', priced Turns only' : ''}
        </Tile>
        <Tile label="Tokens" value={compact.format(series.tokens)}>
          input, output and cache
        </Tile>
        <Tile label="Turns" value={whole.format(series.turns)}>
          reported in this period
        </Tile>
        <Tile
          label="Unpriced"
          value={whole.format(series.unpricedTurns)}
          quiet={series.unpricedTurns === 0}
        >
          {series.unpricedTurns === 0
            ? 'every Turn has a Rate'
            : 'real usage, cost unknown'}
        </Tile>
      </dl>

      <div className="border-rule bg-surface rounded-md border p-4">
        <SpendChart series={series} />
      </div>
    </div>
  )
}

function Tile({
  label,
  value,
  quiet,
  children,
}: {
  label: string
  value: string
  quiet?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="border-rule bg-surface rounded-md border p-4">
      <dt className="text-label text-text-muted uppercase">{label}</dt>
      <dd
        className={`mt-1 font-mono text-figure-lg ${quiet ? 'text-text-muted' : ''}`}
      >
        {value}
      </dd>
      <dd className="text-text-muted mt-1 text-caption">{children}</dd>
    </div>
  )
}

/** The one action an empty Costs offers, hoisted so it is one object. */
const CREATE_A_KEY = { href: '/keys', label: 'Create a key' }

export default async function Costs() {
  const viewer = await currentViewer()
  // The layout above has already refused this case; the narrowing is for the
  // type checker rather than for a reader.
  if (!viewer) return null

  const range = currentMonth(viewer.orgTimezone)

  // One transaction, two independent reads. The spend read is wasted on a
  // deployment with no Turns at all, which is one index probe that finds
  // nothing — cheaper than the second round trip avoiding it would cost.
  const [facts, rows] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      onboardingFacts(tx, viewer.orgId),
      dailySpend(tx, viewer.orgId, viewer.orgTimezone, range),
    ]),
  )

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Costs"
        description={`What ${viewer.orgName} is spending, estimated from usage and published prices.`}
      />
      <Body facts={facts} series={spendSeries(rows, range)} range={range} />
    </div>
  )
}

function Body({
  facts,
  series,
  range,
}: {
  facts: OnboardingFacts
  series: SpendSeries
  range: LocalRange
}) {
  switch (onboardingState(facts)) {
    case 'collecting':
      return <OverTime series={series} range={range} />

    case 'waiting':
      return <Waiting keyUsed={facts.key_used} />

    // No key and no Turn: the Collector has nothing to report with, so that is
    // the one thing worth saying. The sentence is the product IA's, for the
    // Keys surface's own day-one state.
    default:
      return (
        <EmptyState
          headline="Nothing has been collected yet"
          action={CREATE_A_KEY}
        >
          You have no API key yet. The Collector needs one to report.
        </EmptyState>
      )
  }
}

/**
 * The most important screen in the product: a key exists and no Turn has
 * arrived.
 *
 * Two states, not one, and the difference is the last-used time on the key.
 * A key that has never been used means the Collector has not reached this
 * deployment at all; a key that has means it reached us and the problem is
 * downstream of the key rather than in it. From this surface those are
 * otherwise indistinguishable — a report with an unknown or revoked key writes
 * nothing (ticket 34), so it looks exactly like silence.
 *
 * Ticket 39 owns the polling and the list of causes that grows over time.
 * This is the shell's version: say which of the two states it is, and show the
 * install path again.
 */
function Waiting({ keyUsed }: { keyUsed: boolean }) {
  return (
    <section>
      <div className="border-rule bg-surface max-w-3xl rounded-md border p-6">
        <h2 className="text-heading">Waiting for the first Turn</h2>
        <p className="text-text-secondary mt-2 text-body">
          {keyUsed
            ? 'A Collector has reached this deployment with one of your keys, but no Turn has landed yet. The key is not the problem.'
            : 'No Collector has reported with one of your keys yet. The Collector reports when a turn ends, so nothing arrives until one does.'}
        </p>
      </div>

      <InstallCollector appUrl={appUrl()} />
    </section>
  )
}
