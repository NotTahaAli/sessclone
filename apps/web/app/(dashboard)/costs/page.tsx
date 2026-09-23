import Link from 'next/link'

import { Cut } from './[dimension]/[id]/cut'
import { FailuresList } from './failures-list'
import { TimeColumnView } from './over-time-column'
import { RangeControl } from './range-control'
import { RankedList } from './ranked-list'
import { OverTime } from './over-time'
import { Summary } from './summary'
import {
  isDimension,
  resolveTimeColumn,
  resolveView,
  VIEWS,
  type View,
} from './views'
import { EmptyState } from '../empty-state'
import { Finder, FinderColumn, FinderList } from '../finder'
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
  // The failures count is the view menu's badge, shown on every view: failed
  // Sessions in the period this viewer has not marked viewed. It is read on
  // the failures view too, since the list's own total counts every failure,
  // viewed or not, and is a different number.
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
        countFailures(
          tx,
          viewer.orgId,
          viewer.memberId,
          viewer.orgTimezone,
          range,
        ),
        view === 'failures'
          ? sessionFailures(
              tx,
              viewer.orgId,
              viewer.memberId,
              viewer.orgTimezone,
              range,
            )
          : null,
      ]),
  )
  const spend = days === null ? null : spendSeries(days.rows, range, days)
  const failuresCount = counted

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
  // Over time's rows and bars open a day's Sessions or a model's tokens.
  const timeColumn =
    state === 'collecting' && view === 'time' ? resolveTimeColumn(open) : null
  const opened = column !== null || timeColumn !== null

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
      <Finder column={opened}>
        <FinderList column={opened}>
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
        {timeColumn ? (
          <FinderColumn>
            <TimeColumnView
              viewer={viewer}
              column={timeColumn}
              resolved={resolved}
              query={params}
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
              aria-label={`${failuresCount} failed ${
                failuresCount === 1 ? 'Session' : 'Sessions'
              } not yet viewed`}
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
        <FailuresList failures={failures} timezone={timezone} params={params} />
      </>
    )
  }

  switch (onboardingState(facts)) {
    case 'collecting':
      // One of the two is always present, decided by the view above: the read
      // the other view would need was never issued.
      return view === 'time' || !isDimension(view) || ranked === null ? (
        <OverTime
          series={spend!}
          timezone={timezone}
          params={params}
          open={open}
        />
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
      <Summary
        costUsd={cut.totals.costUsd}
        tokens={cut.totals.tokens}
        sessions={cut.totals.sessions}
        unpricedTurns={cut.totals.unpricedTurns}
      />
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
              ? '1 Session failed in this period'
              : `${failuresCount} Sessions failed in this period`}
          </Link>{' '}
          — a turn may be ending on an API error before any usage is written.
        </p>
      ) : null}

      <SectionBreak>Install the Collector</SectionBreak>
      <InstallCollector appUrl={appUrl()} />
    </section>
  )
}
