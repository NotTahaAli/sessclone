import { SessionRows } from './session-rows'
import { dayName } from './summary'
import { sessionCount, TokenTable } from './token-table'
import type { TimeColumn } from './views'
import { ColumnHead } from '../finder'
import { hrefWith, type Query } from '../query'
import { asViewer } from '../../../lib/db'
import { addDays, UNKNOWN_MODEL, type LocalRange } from '../../../lib/series'
import type { ResolvedRange } from '../../../lib/range'
import {
  sessionCursorOf,
  sessionList,
  type SessionRow,
} from '../../../lib/sessions'
import { tokenBreakdown, type TokenBreakdown } from '../../../lib/tokens'
import type { Viewer } from '../../../lib/viewer'

// What an Over time row opens (Taha, 2026-09-23): a day, or one model. The
// Finder column on desktop and the list's place on a phone, as a breakdown
// row's cut is (`[dimension]/[id]/cut.tsx`).
//
// Each column is two statements, both reads the product already makes: the
// cut's tokens by class (`tokenBreakdown`, one aggregate) and its Sessions
// (`sessionList`, the Sessions page's own statement, paged by its cursor).
// The Role scoping is the policies' (ADR 0001), so a Member opening a day
// sees their own Sessions in it.

export async function TimeColumnView({
  viewer,
  column,
  resolved,
  query,
}: {
  viewer: Viewer
  column: TimeColumn
  resolved: ResolvedRange
  query: Query
}) {
  const closeHref = hrefWith('/costs', query, { open: undefined })
  return column.kind === 'day' ? (
    <DayColumn
      viewer={viewer}
      date={column.date}
      query={query}
      closeHref={closeHref}
    />
  ) : (
    <ModelColumn
      viewer={viewer}
      model={column.model}
      range={resolved.range}
      query={query}
      closeHref={closeHref}
    />
  )
}

async function DayColumn({
  viewer,
  date,
  query,
  closeHref,
}: {
  viewer: Viewer
  date: string
  query: Query
  closeHref: string
}) {
  const range = { from: date, to: addDays(date, 1) }
  const [tokens, page] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      tokenBreakdown(tx, viewer.orgId, viewer.orgTimezone, range, {
        kind: 'all',
      }),
      sessionList(
        tx,
        viewer.orgId,
        viewer.orgTimezone,
        range,
        {},
        { before: sessionCursorOf(query.before) },
      ),
    ]),
  )
  return (
    <DaySessions
      date={date}
      tokens={tokens}
      page={page}
      timezone={viewer.orgTimezone}
      query={query}
      closeHref={closeHref}
    />
  )
}

type Page = { sessions: SessionRow[]; more: boolean }

/** A day's column, drawn: apart from the read so a preview can stub it. */
export function DaySessions({
  date,
  tokens,
  page,
  timezone,
  query,
  closeHref,
}: {
  date: string
  tokens: TokenBreakdown
  page: Page
  timezone: string
  query: Query
  closeHref: string
}) {
  return (
    <div className="flex flex-col">
      <ColumnHead
        closeHref={closeHref}
        sub={`${sessionCount(tokens.sessions)} with a Turn on this day`}
      >
        {dayName(date)}
      </ColumnHead>
      <TokenTable totals={tokens} models={tokens.models} />
      <SessionRows
        page={page}
        timezone={timezone}
        empty="No Session you can see had a Turn on this day."
        path="/costs"
        query={query}
      />
    </div>
  )
}

async function ModelColumn({
  viewer,
  model,
  range,
  query,
  closeHref,
}: {
  viewer: Viewer
  model: string
  range: LocalRange
  query: Query
  closeHref: string
}) {
  const named = model === UNKNOWN_MODEL ? null : model
  const [tokens, page] = await asViewer(viewer.userId, (tx) =>
    Promise.all([
      tokenBreakdown(tx, viewer.orgId, viewer.orgTimezone, range, {
        kind: 'model',
        model: named,
      }),
      sessionList(
        tx,
        viewer.orgId,
        viewer.orgTimezone,
        range,
        { model: named },
        { before: sessionCursorOf(query.before) },
      ),
    ]),
  )

  return (
    <ModelTokens
      model={model}
      tokens={tokens}
      page={page}
      timezone={viewer.orgTimezone}
      query={query}
      closeHref={closeHref}
    />
  )
}

/** A model's column, drawn: apart from the read, as above. */
export function ModelTokens({
  model,
  tokens,
  page,
  timezone,
  query,
  closeHref,
}: {
  model: string
  tokens: TokenBreakdown
  page: Page
  timezone: string
  query: Query
  closeHref: string
}) {
  return (
    <div className="flex flex-col">
      <ColumnHead
        closeHref={closeHref}
        sub={`${sessionCount(tokens.sessions)} in this period`}
      >
        <span className={model === UNKNOWN_MODEL ? '' : 'font-mono'}>
          {model}
        </span>
      </ColumnHead>
      {/* A model's own column has no split by model: it would be one row
          repeating the table above it. */}
      <TokenTable totals={tokens} />
      <p className="text-text-muted mt-3 text-caption">
        Cache write is the reported creation total, priced at its 5-minute and
        1-hour Rates. The total is what every Costs figure adds up, so it also
        counts web searches and fetches.
      </p>
      <SessionRows
        page={page}
        timezone={timezone}
        empty="No Session you can see used this model in this period."
        path="/costs"
        query={query}
      />
    </div>
  )
}
