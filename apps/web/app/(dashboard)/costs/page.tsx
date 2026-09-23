import Link from 'next/link'

import { Cut } from './[dimension]/[id]/cut'
import { FailuresList } from './failures-list'
import { RangeControl } from './range-control'
import { RankedList } from './ranked-list'
import { dayName, Sparkline, Summary } from './summary'
import { isDimension, resolveView, VIEWS, type View } from './views'
import { EmptyState } from '../empty-state'
import { Finder, FinderColumn, FinderList } from '../finder'
import { todayIn } from '../sessions/status'
import { InstallCollector } from '../install-collector'
import { PageHeader } from '../page-header'
import { hrefWith, one, type Query } from '../query'
import { MenuItem, PillMenu } from '../../_ui/pill-menu'
import { Row, SectionBreak } from '../../_ui/primitives'
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
import { compact, count, usd } from '../../../lib/money'
import { resolveRange, type RangeParams } from '../../../lib/range'
import { dailySpend, spendSeries, type SpendSeries } from '../../../lib/series'
import { currentViewer } from '../../../lib/viewer'

// Costs. Ticket 45 owns the frame and the states before there is anything to
// draw, 52 the spend over time, 53 the period, and 54 to 56 the three
// breakdowns — by person, by codebase and by machine.
//
// Four views, one period. The view and the period are both in the URL and the
// period survives a switch between views, because the reader is changing the
// cut rather than the question. Which rows each Role sees is the policy's
// answer and not this page's (ADR 0001).
//
// Ticket 112 redraws it in Direction A: the period and the view are two pills
// in the header instead of a tab row and a chip grid, the four tiles are one
// summary line, and a breakdown row opens its Turns in a column on the right
// on desktop (`?open=`), the list staying where it is. Every read is the one
// the page made before.

/** The one action an empty Costs offers, hoisted so it is one object. */
const CREATE_A_KEY = { href: '/keys', label: 'Create a key' }

type Params = RangeParams & {
  view?: string | string[]
  open?: string | string[]
}

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
  // The failures count is the view menu's badge, shown on every view — but on
  // the failures view itself the row read already carries the full total from
  // one statement, so counting again there would be a second count that could
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

  // The open row, when a breakdown is showing: its Turns go in the column.
  // The catch-all on People has no id and opens nothing.
  const open = one(params.open)
  const column =
    state === 'collecting' &&
    isDimension(view) &&
    open &&
    !(open === 'none' && view === 'members')
      ? { dimension: view, id: open }
      : null

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Costs"
        actions={
          showChrome ? (
            <>
              <RangeControl path="/costs" resolved={resolved} query={params} />
              <ViewMenu
                current={view}
                params={params}
                failuresCount={failuresCount}
              />
            </>
          ) : null
        }
      />
      <Finder column={column !== null}>
        <FinderList column={column !== null}>
          <Body
            facts={facts}
            view={view}
            spend={spend}
            ranked={ranked}
            failures={failures}
            failuresCount={failuresCount}
            timezone={viewer.orgTimezone}
            params={params}
            open={open}
          />
        </FinderList>
        {column ? (
          <FinderColumn>
            <Cut
              viewer={viewer}
              dimension={column.dimension}
              id={column.id}
              resolved={resolved}
              query={params}
              closeHref={hrefWith('/costs', params, { open: undefined })}
            />
          </FinderColumn>
        ) : null}
      </Finder>
    </div>
  )
}

/**
 * The five cuts, as one header pill (ticket 112) in place of the tab row.
 *
 * Each is a link rather than a control, for the same reason the period is:
 * choosing a view is a navigation. The open column belongs to one cut, so a
 * switch closes it. The failures count stays on the entry, and on the pill
 * while it is not the view being read.
 */
function ViewMenu({
  current,
  params,
  failuresCount,
}: {
  current: View
  params: Query
  failuresCount: number
}) {
  const label = VIEWS.find((view) => view.key === current)?.label ?? ''
  const badge = failuresCount > 99 ? '99+' : String(failuresCount)
  return (
    <PillMenu
      label={label}
      detail={
        current !== 'failures' && failuresCount > 0
          ? `${badge} failed`
          : undefined
      }
      menuLabel="Costs views"
    >
      {VIEWS.map((view) => (
        <MenuItem
          key={view.key}
          on={view.key === current}
          href={hrefWith('/costs', params, {
            view: view.key === 'time' ? undefined : view.key,
            open: undefined,
          })}
        >
          <span className="grow">{view.label}</span>
          {view.key === 'failures' && failuresCount > 0 ? (
            <span
              className="text-text-muted font-mono text-caption"
              aria-label={`${failuresCount} in this period`}
            >
              {badge}
            </span>
          ) : null}
        </MenuItem>
      ))}
    </PillMenu>
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
  open,
}: {
  facts: OnboardingFacts
  view: View
  spend: SpendSeries | null
  ranked: Breakdown | null
  failures: Failures | null
  failuresCount: number
  timezone: string
  /** The current query, so every link keeps the period. */
  params: Query
  open: string | undefined
}) {
  // The failures view stands apart from the onboarding states: a failure can
  // arrive before the first Turn, so it renders whenever a key exists rather
  // than only once collecting has begun. With no key at all there can be no
  // failure, so that case falls through to the empty state below.
  if (view === 'failures' && failures && onboardingState(facts) !== 'no-key') {
    return (
      <>
        <SectionBreak>Failed turns</SectionBreak>
        <FailuresList failures={failures} timezone={timezone} />
      </>
    )
  }

  switch (onboardingState(facts)) {
    case 'collecting':
      // One of the two is always present, decided by the view above: the read
      // the other view would need was never issued.
      return view === 'time' || !isDimension(view) || ranked === null ? (
        <OverTime series={spend!} timezone={timezone} />
      ) : (
        <Ranked cut={ranked} dimension={view} params={params} open={open} />
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
 * Spend over time: the summary with a bar a day beside it, then the models
 * the money went to and the days that had any.
 *
 * The By model rows are the legend of ticket 52's stacked chart, as rows: the
 * five largest models and Other, from the same series. The By day rows are
 * what that chart's table carried — the numbers a phone reader and a screen
 * reader get instead of a tooltip. Days with nothing in them are left out:
 * the bars already show the gap.
 */
function OverTime({
  series,
  timezone,
}: {
  series: SpendSeries
  timezone: string
}) {
  if (series.turns === 0) {
    // Not the onboarding state: Turns exist, this window has none of them.
    return (
      <EmptyState headline="Nothing in this period">
        Turns have arrived, but none of them fall between these dates. Pick a
        wider period above.
      </EmptyState>
    )
  }

  const peak = Math.max(...series.series.map((entry) => entry.costUsd), 0)
  const used = series.days.filter((day) => day.turns > 0).toReversed()

  return (
    <>
      <Summary
        costUsd={series.costUsd}
        tokens={series.tokens}
        turns={series.turns}
        unpricedTurns={series.unpricedTurns}
      >
        <Sparkline days={series.days} today={todayIn(timezone)} />
      </Summary>

      {series.series.length > 0 ? (
        <>
          <SectionBreak>By model</SectionBreak>
          <ol>
            {series.series.map((entry) => (
              <li key={entry.label}>
                <Row
                  lead="none"
                  value={usd(entry.costUsd)}
                  meter={peak > 0 ? entry.costUsd / peak : 0}
                >
                  <span className="font-mono">{entry.label}</span>
                </Row>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <SectionBreak>By day</SectionBreak>
      <ol>
        {used.map((day) => (
          <li key={day.date}>
            <Row
              lead="none"
              name={dayName(day.date)}
              // A day whose every Turn is unpriced is unknown, not zero.
              value={day.unpricedTurns === day.turns ? '—' : usd(day.costUsd)}
              sub={`${compact.format(day.tokens)} tokens · ${count.format(
                day.turns,
              )} ${day.turns === 1 ? 'turn' : 'turns'}${
                day.unpricedTurns > 0
                  ? ` · ${count.format(day.unpricedTurns)} unpriced`
                  : ''
              }`}
            />
          </li>
        ))}
      </ol>

      <p className="text-text-muted mt-4 text-caption">
        Cost is an estimate, derived from the usage reported and the published
        prices. Days are the Org&apos;s own.
      </p>
    </>
  )
}

/** What each breakdown's rows are, as the break above them says it. */
const BY: Record<Dimension, string> = {
  members: 'By person',
  projects: 'By project',
  devices: 'By device',
}

/**
 * A breakdown, with the same summary above it as Over time has.
 *
 * The summary comes from the same statement as the list, over every group
 * rather than the ones shown: the list is capped and a total summed from a
 * capped list drops the tail without saying so.
 */
function Ranked({
  cut,
  dimension,
  params,
  open,
}: {
  cut: Breakdown
  dimension: Dimension
  params: Query
  open: string | undefined
}) {
  return (
    <>
      <Summary {...cut.totals} />
      <SectionBreak>{BY[dimension]}</SectionBreak>
      <RankedList
        rows={cut.rows}
        total={cut.totals.costUsd}
        more={cut.more}
        moreUnpriced={cut.moreUnpriced}
        dimension={dimension}
        params={params}
        open={open}
      />
    </>
  )
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
  /** The current query, so the link carries the period the count was read
   * for. */
  params: Query
}) {
  return (
    <section className="max-w-3xl">
      <SectionBreak>Status</SectionBreak>
      <Row
        lead="idle"
        name="Waiting for the first Turn"
        meta={keyUsed ? 'key used' : 'key never used'}
      />
      <p className="text-text-muted text-body">
        {keyUsed
          ? 'A Collector has reached this deployment with one of your keys, but no Turn has landed yet. The key is not the problem.'
          : 'No Collector has reported with one of your keys yet. The Collector reports when a turn ends, so nothing arrives until one does.'}
      </p>
      {failuresCount > 0 ? (
        <p className="mt-3 text-body">
          <Link
            href={hrefWith('/costs', params, { view: 'failures' })}
            className="underline"
          >
            {failuresCount === 1
              ? '1 failure was recorded in this period'
              : `${failuresCount} failures were recorded in this period`}
          </Link>{' '}
          — a turn may be ending on an API error before any usage is written.
        </p>
      ) : null}

      <SectionBreak>Install the Collector</SectionBreak>
      <InstallCollector appUrl={appUrl()} />
    </section>
  )
}
