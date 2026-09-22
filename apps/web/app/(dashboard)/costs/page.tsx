import { FailuresList } from './failures-list'
import { RangeControl } from './range-control'
import { RankedList } from './ranked-list'
import { SpendChart } from './spend-chart'
import {
  DEFAULT_VIEW,
  isDimension,
  resolveView,
  viewHref,
  VIEWS,
  type View,
} from './views'
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
  breakdown,
  type Breakdown,
  type Dimension,
} from '../../../lib/breakdown'
import {
  countFailures,
  sessionFailures,
  type Failures,
} from '../../../lib/failures'
import { resolveRange, type RangeParams } from '../../../lib/range'
import { dailySpend, spendSeries, type SpendSeries } from '../../../lib/series'
import { currentViewer } from '../../../lib/viewer'
import Link from 'next/link'

// Costs. Ticket 45 owns the frame and the states before there is anything to
// draw, 52 the spend over time, 53 the period, and 54 to 56 the three
// breakdowns — by person, by codebase and by machine.
//
// Four views, one period. The view and the period are both in the URL and the
// period survives a switch between views, because the reader is changing the
// cut rather than the question. Which rows each Role sees is the policy's
// answer and not this page's (ADR 0001).
//
// The range is ticket 53's: read from the URL, defaulting to the current
// calendar month in the Org's timezone, which
// `docs/design/dashboard-wireframes.md` chose because it is the period a bill
// is drawn on. It is resolved once here and passed down — the control renders
// it, the read takes it, and the breakdowns in 54 to 56 will take the same
// object rather than parsing the URL again.

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})
const compact = new Intl.NumberFormat('en-US', { notation: 'compact' })
const whole = new Intl.NumberFormat('en-US')

/**
 * Spend over time, and the four figures that say what the bars are made of.
 *
 * The unpriced count is a tile rather than a footnote: `turn_costs` leaves a
 * Turn's cost null when a quantity it consumed has no Rate, so the total is a
 * floor whenever that count is not zero, and a reader who cannot see it reads
 * the floor as the answer (ADR 0002).
 */
function OverTime({ series }: { series: SpendSeries }) {
  if (series.turns === 0) {
    // Not the onboarding state: Turns exist, this window has none of them.
    return (
      <EmptyState headline="Nothing in this period">
        Turns have arrived, but none of them fall between these dates. Pick a
        wider period above.
      </EmptyState>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Totals
        costUsd={series.costUsd}
        tokens={series.tokens}
        turns={series.turns}
        unpricedTurns={series.unpricedTurns}
      />

      <div className="border-rule bg-surface rounded-md border p-4">
        <SpendChart series={series} />
      </div>
    </div>
  )
}

/**
 * A breakdown, with the same four figures above it as the chart has.
 *
 * The tiles come from the same statement as the list, over every group rather
 * than the ones shown: the list is capped and a total summed from a capped
 * list drops the tail without saying so.
 */
function Ranked({
  cut,
  dimension,
  params,
}: {
  cut: Breakdown
  dimension: Dimension
  /** The period, so a row's link opens the Turns of the period it was ranked
   * for (ticket 88). */
  params: Record<string, string | string[] | undefined>
}) {
  return (
    <div className="flex flex-col gap-6">
      <Totals {...cut.totals} />
      <div className="border-rule bg-surface rounded-md border p-4">
        <RankedList
          rows={cut.rows}
          total={cut.totals.costUsd}
          more={cut.more}
          moreUnpriced={cut.moreUnpriced}
          dimension={dimension}
          params={params}
        />
      </div>
    </div>
  )
}

/** The four figures every Costs view carries, in the same order everywhere. */
function Totals({
  costUsd,
  tokens,
  turns,
  unpricedTurns,
}: {
  costUsd: number | null
  tokens: number
  turns: number
  unpricedTurns: number
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* A period with nothing priced is unknown, not free. */}
      <Tile label="Cost" value={costUsd === null ? '—' : money.format(costUsd)}>
        {costUsd === null
          ? 'nothing priced yet'
          : unpricedTurns > 0
            ? 'priced Turns only'
            : 'this period'}
      </Tile>
      <Tile label="Tokens" value={compact.format(tokens)}>
        input, output and cache
      </Tile>
      <Tile label="Turns" value={whole.format(turns)}>
        reported in this period
      </Tile>
      <Tile
        label="Unpriced"
        value={whole.format(unpricedTurns)}
        quiet={unpricedTurns === 0}
      >
        {unpricedTurns === 0
          ? 'every Turn has a Rate'
          : 'real usage, cost unknown'}
      </Tile>
    </dl>
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

/**
 * The four cuts, as links.
 *
 * A link rather than a control, for the same reason the period is: choosing a
 * view is a navigation, and a navigation is what a browser already does well.
 */
function ViewTabs({
  current,
  params,
  failuresCount,
}: {
  current: View
  params: Record<string, string | string[] | undefined>
  /** Drawn as a badge on the Failures tab when the period holds any. */
  failuresCount: number
}) {
  return (
    <nav aria-label="Costs views">
      <ul className="border-rule flex gap-1 overflow-x-auto border-b">
        {VIEWS.map((view) => {
          const active = view.key === current
          const badge = view.key === 'failures' && failuresCount > 0
          return (
            <li key={view.key}>
              <Link
                href={viewHref('/costs', view.key, params)}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-body whitespace-nowrap ${
                  active
                    ? 'border-accent-border text-accent-text'
                    : 'text-text-secondary border-transparent'
                }`}
              >
                {view.label}
                {badge ? (
                  <span
                    className="bg-bad-bg text-bad-text rounded-full px-1.5 font-mono text-micro"
                    aria-label={`${failuresCount} in this period`}
                  >
                    {failuresCount > 99 ? '99+' : failuresCount}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The one action an empty Costs offers, hoisted so it is one object. */
const CREATE_A_KEY = { href: '/keys', label: 'Create a key' }

type Params = RangeParams & { view?: string | string[] }

export default async function Costs({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  const viewer = await currentViewer()
  // The layout above has already refused this case; the narrowing is for the
  // type checker rather than for a reader.
  if (!viewer) return null

  // Ticket 53: the period comes from the URL, so a link to this page is a link
  // to a period. Anything the URL cannot mean falls back to the default rather
  // than failing the page.
  const params = await searchParams
  const resolved = resolveRange(params, viewer.orgTimezone)
  const { range } = resolved
  const view = resolveView(params.view)

  // One transaction, and only the reads this view needs beside the facts that
  // decide whether there is anything to draw at all. The reads are
  // independent, so they go together rather than one after the other.
  //
  // The failures count is the tab's badge, shown on every view — but on the
  // failures view itself the row read already carries the full total from one
  // statement, so counting again there would be a second count that could
  // disagree with the list beside it under a concurrent insert.
  const [facts, days, ranked, counted, failures] = await asViewer(
    viewer.userId,
    (tx) =>
      Promise.all([
        onboardingFacts(tx, viewer.orgId),
        view === 'time'
          ? dailySpend(tx, viewer.orgId, viewer.orgTimezone, range)
          : null,
        isDimension(view)
          ? breakdown(tx, viewer.orgId, viewer.orgTimezone, range, view)
          : null,
        view === 'failures'
          ? null
          : countFailures(tx, viewer.orgId, viewer.orgTimezone, range),
        view === 'failures'
          ? sessionFailures(tx, viewer.orgId, viewer.orgTimezone, range)
          : null,
      ]),
  )
  const spend = days === null ? null : spendSeries(days, range)
  const failuresCount = failures ? failures.total : (counted ?? 0)

  // The failures view (and its link from the waiting surface) is reachable
  // whenever a key exists, since a failure can arrive before the first Turn —
  // that is exactly the stalled-Collector case worth surfacing.
  const state = onboardingState(facts)
  const showFailures = view === 'failures' && state !== 'no-key'
  const showChrome = state === 'collecting' || showFailures

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Costs"
        description={`What ${viewer.orgName} is spending, estimated from usage and published prices.`}
      />
      {showChrome ? (
        <>
          <ViewTabs
            current={view}
            params={params}
            failuresCount={failuresCount}
          />
          <RangeControl
            path="/costs"
            resolved={resolved}
            view={view === DEFAULT_VIEW ? undefined : view}
          />
        </>
      ) : null}
      <Body
        facts={facts}
        view={view}
        spend={spend}
        ranked={ranked}
        failures={failures}
        failuresCount={failuresCount}
        timezone={viewer.orgTimezone}
        params={params}
      />
    </div>
  )
}

function Body({
  facts,
  view,
  spend,
  ranked,
  failures,
  failuresCount,
  timezone,
  params,
}: {
  facts: OnboardingFacts
  view: View
  spend: SpendSeries | null
  ranked: Breakdown | null
  failures: Failures | null
  failuresCount: number
  timezone: string
  /** The current query, so the link to the failures view keeps the period. */
  params: Record<string, string | string[] | undefined>
}) {
  // The failures view stands apart from the onboarding states: a failure can
  // arrive before the first Turn, so it renders whenever a key exists rather
  // than only once collecting has begun. With no key at all there can be no
  // failure, so that case falls through to the empty state below.
  if (view === 'failures' && failures && onboardingState(facts) !== 'no-key') {
    return <FailuresList failures={failures} timezone={timezone} />
  }

  switch (onboardingState(facts)) {
    case 'collecting':
      // One of the two is always present, decided by the view above: the read
      // the other view would need was never issued.
      return view === 'time' || !isDimension(view) || ranked === null ? (
        <OverTime series={spend!} />
      ) : (
        <Ranked cut={ranked} dimension={view} params={params} />
      )

    case 'waiting':
      return (
        <Waiting
          keyUsed={facts.key_used}
          failuresCount={failuresCount}
          params={params}
        />
      )

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
function Waiting({
  keyUsed,
  failuresCount,
  params,
}: {
  keyUsed: boolean
  /** Failures in the current period: where a stalled Collector is first
   * noticed, so the surface links to them when there are any (ticket 78). */
  failuresCount: number
  /** The current query, so the link carries the period the count was read for
   * — the same rule `viewHref` and `presetHref` keep everywhere else. A link
   * that dropped the range would promise a count the destination then cuts a
   * different period for. */
  params: Record<string, string | string[] | undefined>
}) {
  return (
    <section>
      <div className="border-rule bg-surface max-w-3xl rounded-md border p-6">
        <h2 className="text-heading">Waiting for the first Turn</h2>
        <p className="text-text-secondary mt-2 text-body">
          {keyUsed
            ? 'A Collector has reached this deployment with one of your keys, but no Turn has landed yet. The key is not the problem.'
            : 'No Collector has reported with one of your keys yet. The Collector reports when a turn ends, so nothing arrives until one does.'}
        </p>
        {failuresCount > 0 ? (
          <p className="mt-3 text-body">
            <Link
              href={viewHref('/costs', 'failures', params)}
              className="text-accent-text"
            >
              {failuresCount === 1
                ? '1 failure was recorded in this period'
                : `${failuresCount} failures were recorded in this period`}
            </Link>{' '}
            — a turn may be ending on an API error before any usage is written.
          </p>
        ) : null}
      </div>

      <InstallCollector appUrl={appUrl()} />
    </section>
  )
}
