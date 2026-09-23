import Link from 'next/link'

import { dayName } from './summary'
import type { TimeColumn } from './views'
import { ColumnHead } from '../finder'
import { hrefWith, type Query } from '../query'
import { Row, SectionBreak } from '../../_ui/primitives'
import { asViewer } from '../../../lib/db'
import { compact, count, usd } from '../../../lib/money'
import {
  addDays,
  modelBreakdown,
  UNKNOWN_MODEL,
  type ModelBreakdown,
} from '../../../lib/series'
import type { ResolvedRange } from '../../../lib/range'
import {
  sessionCursorOf,
  sessionList,
  type SessionRow,
} from '../../../lib/sessions'
import type { Viewer } from '../../../lib/viewer'

// What an Over time row opens (Taha, 2026-09-23): a day's Sessions, or one
// model's tokens by class. The Finder column on desktop and the list's place
// on a phone, as a breakdown row's Turns are (`[dimension]/[id]/cut.tsx`).
//
// Both are reads the product already makes. A day is `sessionList` over one
// calendar day in the Org's timezone — the Sessions page's own statement,
// paged by the same cursor — and a model is `modelBreakdown`, which prices
// through the same Rate resolution a single Turn's breakdown does. The Role
// scoping is the policies' (ADR 0001), so a Member opening a day sees their
// own Sessions in it.

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
      resolved={resolved}
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
  const page = await asViewer(viewer.userId, (tx) =>
    sessionList(
      tx,
      viewer.orgId,
      viewer.orgTimezone,
      { from: date, to: addDays(date, 1) },
      {},
      { before: sessionCursorOf(query.before) },
    ),
  )
  return (
    <DaySessions date={date} page={page} query={query} closeHref={closeHref} />
  )
}

/** A day's Sessions, drawn: apart from the read so a preview can stub it. */
export function DaySessions({
  date,
  page,
  query,
  closeHref,
}: {
  date: string
  page: { sessions: SessionRow[]; more: boolean }
  query: Query
  closeHref: string
}) {
  const last = page.sessions.at(-1)

  return (
    <div className="flex flex-col">
      <ColumnHead closeHref={closeHref} sub="Sessions with a Turn on this day">
        {dayName(date)}
      </ColumnHead>
      <SectionBreak>Sessions</SectionBreak>
      {page.sessions.length === 0 ? (
        <p className="text-text-muted py-3 text-body">
          No Session you can see had a Turn on this day.
        </p>
      ) : (
        <ol>
          {page.sessions.map((session) => {
            const named = session.label ?? session.projectName
            return (
              <li key={`${session.memberId}:${session.sessionId}`}>
                <Row
                  href={`/sessions/${encodeURIComponent(session.sessionId)}?member=${session.memberId}`}
                  value={usd(session.costUsd)}
                  sub={`${compact.format(session.tokens)} tokens · ${count.format(
                    session.turns,
                  )} ${session.turns === 1 ? 'Turn' : 'Turns'}${
                    session.unpricedTurns > 0
                      ? ` · ${count.format(session.unpricedTurns)} unpriced`
                      : ''
                  } · ${
                    session.memberName ??
                    session.memberEmail ??
                    'Outside your view'
                  }`}
                >
                  <span
                    className={
                      named
                        ? ''
                        : session.projectKey
                          ? 'font-mono'
                          : 'text-text-muted'
                    }
                  >
                    {named ?? session.projectKey ?? 'Outside a repository'}
                  </span>
                </Row>
              </li>
            )
          })}
        </ol>
      )}
      {/* The same cursor the Sessions list pages by, so a boundary cannot
          repeat or skip a Session. */}
      {page.more && last ? (
        <p className="mt-3 text-body">
          <Link
            href={hrefWith('/costs', query, {
              before: `${last.lastTurnAt},${last.sessionId}`,
            })}
            className="text-text-muted hover:text-text"
          >
            More sessions ›
          </Link>
        </p>
      ) : null}
    </div>
  )
}

async function ModelColumn({
  viewer,
  model,
  resolved,
  closeHref,
}: {
  viewer: Viewer
  model: string
  resolved: ResolvedRange
  closeHref: string
}) {
  const cut = await asViewer(viewer.userId, (tx) =>
    modelBreakdown(
      tx,
      viewer.orgId,
      viewer.orgTimezone,
      resolved.range,
      model === UNKNOWN_MODEL ? null : model,
    ),
  )

  return <ModelTokens model={model} cut={cut} closeHref={closeHref} />
}

/** A model's tokens by class, drawn: apart from the read, as above. */
export function ModelTokens({
  model,
  cut,
  closeHref,
}: {
  model: string
  cut: ModelBreakdown
  closeHref: string
}) {
  return (
    <div className="flex flex-col">
      <ColumnHead
        closeHref={closeHref}
        sub={`${count.format(cut.turns)} ${cut.turns === 1 ? 'Turn' : 'Turns'} in this period`}
      >
        <span className={model === UNKNOWN_MODEL ? '' : 'font-mono'}>
          {model}
        </span>
      </ColumnHead>
      <SectionBreak>Tokens</SectionBreak>
      <ol>
        {cut.classes.map((entry) => (
          <li key={entry.key}>
            <Row
              lead="none"
              name={entry.label}
              // Unknown, never zero, when some of these tokens have no Rate.
              value={entry.costUsd === null ? 'unpriced' : usd(entry.costUsd)}
              sub={`${compact.format(entry.tokens)} tokens`}
            />
          </li>
        ))}
        <li className="border-rule mt-1 border-t">
          <Row
            lead="none"
            value={usd(cut.costUsd)}
            sub={`${compact.format(cut.tokens)} tokens${
              cut.unpricedTurns > 0
                ? ` · ${count.format(cut.unpricedTurns)} unpriced ${
                    cut.unpricedTurns === 1 ? 'Turn' : 'Turns'
                  } not in it`
                : ''
            }`}
          >
            <span className="font-semibold">Total</span>
          </Row>
        </li>
      </ol>
      <p className="text-text-muted mt-3 text-caption">
        Cache write is the reported creation total, priced at its 5-minute and
        1-hour Rates. The total is what every Costs figure adds up, so it also
        counts web searches and fetches.
      </p>
    </div>
  )
}
